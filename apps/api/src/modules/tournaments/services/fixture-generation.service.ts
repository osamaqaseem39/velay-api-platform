import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { BracketNode } from '../entities/bracket-node.entity';
import { GroupMember } from '../entities/group-member.entity';
import { Standing } from '../entities/standing.entity';
import { TournamentFixture } from '../entities/tournament-fixture.entity';
import { TournamentGroup } from '../entities/tournament-group.entity';
import { TournamentMatch } from '../entities/tournament-match.entity';
import { TournamentRegistration } from '../entities/tournament-registration.entity';
import { TournamentStage } from '../entities/tournament-stage.entity';
import { TournamentDivision } from '../entities/tournament-division.entity';
import { TournamentConfigVersion } from '../entities/tournament-config-version.entity';
import { generateKnockoutBracket } from '../engines/bracket.engine';
import { generateRoundRobinFixtures } from '../engines/fixture.engine';
import {
  DEFAULT_STANDINGS_RULES,
  TOURNAMENT_ERROR_CODES,
  type StandingsRules,
  type StructureBlueprint,
} from '../types/tournament.types';
import {
  pickAdvancingTeams,
  type GroupStandingInput,
} from '../engines/advancement.engine';
import { KnockoutBracketService } from './knockout-bracket.service';

@Injectable()
export class FixtureGenerationService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TournamentDivision)
    private readonly divisions: Repository<TournamentDivision>,
    @InjectRepository(TournamentStage)
    private readonly stages: Repository<TournamentStage>,
    @InjectRepository(TournamentConfigVersion)
    private readonly configs: Repository<TournamentConfigVersion>,
    @InjectRepository(TournamentRegistration)
    private readonly registrations: Repository<TournamentRegistration>,
    @InjectRepository(TournamentGroup)
    private readonly groups: Repository<TournamentGroup>,
    @InjectRepository(GroupMember)
    private readonly groupMembers: Repository<GroupMember>,
    @InjectRepository(TournamentMatch)
    private readonly matches: Repository<TournamentMatch>,
    @InjectRepository(TournamentFixture)
    private readonly fixtures: Repository<TournamentFixture>,
    @InjectRepository(BracketNode)
    private readonly bracketNodes: Repository<BracketNode>,
    @InjectRepository(Standing)
    private readonly standings: Repository<Standing>,
    private readonly knockoutBracket: KnockoutBracketService,
  ) {}

  async generateStage(
    divisionId: string,
    stageOrder: number,
  ): Promise<{ stageId: string; matchesCreated: number }> {
    const division = await this.divisions.findOne({
      where: { id: divisionId, deletedAt: IsNull() },
    });
    if (!division?.currentConfigVersionId) {
      throw new Error('Tournament config missing');
    }

    const stage = await this.stages.findOne({
      where: { divisionId, order: stageOrder },
    });
    if (!stage) throw new Error('Stage not found');

    const config = await this.configs.findOne({
      where: { id: division.currentConfigVersionId },
    });
    if (!config) throw new Error('Config not found');

    const blueprint = config.structureBlueprint as StructureBlueprint;
    const approved = await this.registrations.find({
      where: {
        divisionId,
        status: 'approved' as const,
      },
    });
    let teamIds = approved.map((r) => r.teamId);

    if (stage.stageType === 'knockout' && blueprint.knockout) {
      const prevGroup = await this.stages.findOne({
        where: {
          divisionId,
          stageType: 'group',
          order: LessThan(stageOrder),
        },
        order: { order: 'DESC' },
      });
      if (prevGroup) {
        await this.assertGroupStageComplete(divisionId, prevGroup.id);
        teamIds = await this.resolveAdvancingTeamIds(
          divisionId,
          prevGroup.id,
          blueprint,
          (config.standingsRules as StandingsRules) ?? DEFAULT_STANDINGS_RULES,
        );
        if (teamIds.length < 2) {
          throw new ConflictException({
            code: TOURNAMENT_ERROR_CODES.STAGE_NOT_READY,
            message: 'Not enough teams qualified for knockout',
          });
        }
      }
    }

    let matchesCreated = 0;

    await this.dataSource.transaction(async (manager) => {
      stage.status = 'generating';
      await manager.save(TournamentStage, stage);

      if (stage.stageType === 'group' && blueprint.groups?.length) {
        matchesCreated = await this.generateGroupStage(
          manager,
          division,
          stage,
          blueprint,
          teamIds,
        );
      } else if (stage.stageType === 'knockout') {
        matchesCreated = await this.generateKnockoutStage(
          manager,
          division,
          stage,
          blueprint,
          teamIds,
        );
      }

      stage.status = 'ready';
      await manager.save(TournamentStage, stage);
    });

    return { stageId: stage.id, matchesCreated };
  }

  async resetStage(
    divisionId: string,
    stageOrder: number,
  ): Promise<{ stageId: string }> {
    const stage = await this.stages.findOne({
      where: { divisionId, order: stageOrder },
    });
    if (!stage) throw new ConflictException('Stage not found');
    if (stage.status === 'pending' || stage.status === 'generating') {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.INVALID_STAGE,
        message: 'Stage has not been generated yet',
      });
    }

    const stageMatches = await this.matches.find({
      where: { divisionId, stageId: stage.id, deletedAt: IsNull() },
    });
    const hasLockedMatch = stageMatches.some((m) =>
      ['approved', 'walkover', 'in_progress', 'completed', 'disputed'].includes(
        m.status,
      ),
    );
    if (hasLockedMatch) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.BRACKET_LOCKED,
        message: 'Cannot reset a stage after matches have started or finished',
      });
    }

    await this.dataSource.transaction(async (manager) => {
      if (stageMatches.length > 0) {
        const matchIds = stageMatches.map((m) => m.id);
        await manager
          .createQueryBuilder()
          .delete()
          .from(TournamentFixture)
          .where('matchId IN (:...matchIds)', { matchIds })
          .execute();
        await manager.delete(TournamentMatch, {
          divisionId,
          stageId: stage.id,
        });
      }
      await manager.delete(BracketNode, { stageId: stage.id });
      if (stage.stageType === 'group') {
        const groups = await manager.find(TournamentGroup, {
          where: { stageId: stage.id },
        });
        for (const group of groups) {
          await manager.delete(Standing, { groupId: group.id });
          await manager.delete(GroupMember, { groupId: group.id });
        }
        await manager.delete(TournamentGroup, { stageId: stage.id });
      }
      stage.status = 'pending';
      await manager.save(TournamentStage, stage);
    });

    return { stageId: stage.id };
  }

  async generateKnockoutRound(
    divisionId: string,
    stageOrder: number,
  ): Promise<{ stageId: string; round: number; matchesCreated: number }> {
    const stage = await this.stages.findOne({
      where: { divisionId, order: stageOrder },
    });
    if (!stage || stage.stageType !== 'knockout') {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.INVALID_STAGE,
        message: 'Knockout stage not found',
      });
    }
    if (stage.status === 'pending' || stage.status === 'generating') {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.INVALID_STAGE,
        message: 'Generate the knockout stage first',
      });
    }

    const result = await this.knockoutBracket.generateNextRound(
      divisionId,
      stage.id,
    );
    if (stage.status === 'ready') {
      stage.status = 'in_progress';
      await this.stages.save(stage);
    }
    return { stageId: stage.id, ...result };
  }

  async swapGroupTeams(
    divisionId: string,
    teamIdA: string,
    teamIdB: string,
  ): Promise<{ groupIdA: string; groupIdB: string }> {
    if (teamIdA === teamIdB) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.INVALID_STAGE,
        message: 'Cannot swap a team with itself',
      });
    }

    const memberA = await this.groupMembers.findOne({
      where: { teamId: teamIdA },
    });
    const memberB = await this.groupMembers.findOne({
      where: { teamId: teamIdB },
    });
    if (!memberA || !memberB) {
      throw new NotFoundException('One or both teams are not in a group');
    }
    if (memberA.groupId === memberB.groupId) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.INVALID_STAGE,
        message: 'Pick a team from a different group',
      });
    }

    const groupA = await this.groups.findOne({ where: { id: memberA.groupId } });
    const groupB = await this.groups.findOne({ where: { id: memberB.groupId } });
    if (!groupA || !groupB || groupA.stageId !== groupB.stageId) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.INVALID_STAGE,
        message: 'Teams must belong to the same group stage',
      });
    }

    const stage = await this.stages.findOne({ where: { id: groupA.stageId } });
    if (!stage || stage.divisionId !== divisionId) {
      throw new NotFoundException('Group stage not found');
    }
    if (stage.stageType !== 'group') {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.INVALID_STAGE,
        message: 'Not a group stage',
      });
    }

    await this.assertStageUnlocked(divisionId, stage.id);

    const division = await this.divisions.findOne({
      where: { id: divisionId, deletedAt: IsNull() },
    });
    if (!division?.currentConfigVersionId) {
      throw new NotFoundException('Tournament config missing');
    }
    const config = await this.configs.findOne({
      where: { id: division.currentConfigVersionId },
    });
    const blueprint = config?.structureBlueprint as StructureBlueprint;

    const groupIdA = memberA.groupId;
    const groupIdB = memberB.groupId;

    await this.dataSource.transaction(async (manager) => {
      memberA.groupId = groupIdB;
      memberB.groupId = groupIdA;
      await manager.save(GroupMember, [memberA, memberB]);

      for (const [teamId, fromGroupId, toGroupId] of [
        [teamIdA, groupIdA, groupIdB],
        [teamIdB, groupIdB, groupIdA],
      ] as const) {
        await manager.update(
          Standing,
          { teamId, groupId: fromGroupId },
          {
            groupId: toGroupId,
            played: 0,
            won: 0,
            drawn: 0,
            lost: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            points: 0,
            rank: null,
            tieBreakData: null,
            manualRankOverride: null,
          },
        );
      }

      await this.regenerateGroupFixtures(
        manager,
        division,
        stage,
        groupIdA,
        blueprint,
      );
      await this.regenerateGroupFixtures(
        manager,
        division,
        stage,
        groupIdB,
        blueprint,
      );
    });

    return { groupIdA, groupIdB };
  }

  private async assertStageUnlocked(
    divisionId: string,
    stageId: string,
  ): Promise<void> {
    const stageMatches = await this.matches.find({
      where: { divisionId, stageId, deletedAt: IsNull() },
    });
    const hasLockedMatch = stageMatches.some((m) =>
      ['approved', 'walkover', 'in_progress', 'completed', 'disputed'].includes(
        m.status,
      ),
    );
    if (hasLockedMatch) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.BRACKET_LOCKED,
        message: 'Cannot change groups after matches have started or finished',
      });
    }
  }

  private async regenerateGroupFixtures(
    manager: DataSource['manager'],
    division: TournamentDivision,
    stage: TournamentStage,
    groupId: string,
    blueprint: StructureBlueprint,
  ): Promise<void> {
    const groupMatches = await manager.find(TournamentMatch, {
      where: { divisionId: division.id, stageId: stage.id, groupId },
    });
    if (groupMatches.length > 0) {
      const matchIds = groupMatches.map((m) => m.id);
      await manager
        .createQueryBuilder()
        .delete()
        .from(TournamentFixture)
        .where('matchId IN (:...matchIds)', { matchIds })
        .execute();
      await manager.delete(TournamentMatch, {
        divisionId: division.id,
        stageId: stage.id,
        groupId,
      });
    }

    const members = await manager.find(GroupMember, {
      where: { groupId },
      order: { teamId: 'ASC' },
    });
    const slice = members.map((m) => m.teamId);
    if (slice.length < 2) return;

    const matchesPerTeam = blueprint.groupStage?.matchesPerTeam;
    const maxRounds =
      matchesPerTeam != null
        ? Math.min(matchesPerTeam, Math.max(1, slice.length - 1))
        : undefined;
    const fixtures = generateRoundRobinFixtures(slice, maxRounds);
    for (const f of fixtures) {
      const match = await manager.save(TournamentMatch, {
        divisionId: division.id,
        stageId: stage.id,
        groupId,
        status: 'draft',
        homeTeamId: f.homeTeamId,
        awayTeamId: f.awayTeamId,
      });
      await manager.save(TournamentFixture, {
        stageId: stage.id,
        groupId,
        round: f.round,
        matchId: match.id,
      });
    }
  }

  private async generateGroupStage(
    manager: DataSource['manager'],
    division: TournamentDivision,
    stage: TournamentStage,
    blueprint: StructureBlueprint,
    teamIds: string[],
  ): Promise<number> {
    const groups = blueprint.groups ?? [];
    let idx = 0;
    let count = 0;
    const shuffled = [...teamIds].sort((a, b) => a.localeCompare(b));

    for (const g of groups) {
      const group = await manager.save(TournamentGroup, {
        stageId: stage.id,
        name: g.name,
      });
      const slice = shuffled.slice(idx, idx + g.size);
      idx += g.size;

      for (const teamId of slice) {
        await manager.save(GroupMember, { groupId: group.id, teamId });
        await manager.save(Standing, { groupId: group.id, teamId });
      }

      const matchesPerTeam = blueprint.groupStage?.matchesPerTeam;
      const maxRounds =
        matchesPerTeam != null
          ? Math.min(matchesPerTeam, Math.max(1, slice.length - 1))
          : undefined;
      const fixtures = generateRoundRobinFixtures(slice, maxRounds);
      for (const f of fixtures) {
        const match = await manager.save(TournamentMatch, {
          divisionId: division.id,
          stageId: stage.id,
          groupId: group.id,
          status: 'draft',
          homeTeamId: f.homeTeamId,
          awayTeamId: f.awayTeamId,
        });
        await manager.save(TournamentFixture, {
          stageId: stage.id,
          groupId: group.id,
          round: f.round,
          matchId: match.id,
        });
        count++;
      }
    }
    return count;
  }

  private async generateKnockoutStage(
    manager: DataSource['manager'],
    division: TournamentDivision,
    stage: TournamentStage,
    blueprint: StructureBlueprint,
    teamIds: string[],
  ): Promise<number> {
    const bracketSize = blueprint.knockout?.bracketSize ?? teamIds.length;
    const drafts = generateKnockoutBracket(teamIds, bracketSize);
    const saved = new Map<string, BracketNode>();
    let count = 0;

    for (const d of drafts) {
      let matchId: string | null = null;
      if (d.round === 1 && !d.isBye && d.teamId && d.awayTeamId) {
        const match = await manager.save(TournamentMatch, {
          divisionId: division.id,
          stageId: stage.id,
          status: 'draft',
          homeTeamId: d.teamId,
          awayTeamId: d.awayTeamId,
        });
        matchId = match.id;
        count++;
        await manager.save(TournamentFixture, {
          stageId: stage.id,
          round: 1,
          matchId: match.id,
        });
      }
      const node = await manager.save(BracketNode, {
        stageId: stage.id,
        round: d.round,
        slotIndex: d.slotIndex,
        teamId: d.teamId ?? null,
        isBye: d.isBye,
        matchId,
      });
      saved.set(`${d.round}-${d.slotIndex}`, node);
    }

    for (const d of drafts) {
      if (d.parentRound == null || d.parentSlotIndex == null) continue;
      const node = saved.get(`${d.round}-${d.slotIndex}`);
      const parent = saved.get(`${d.parentRound}-${d.parentSlotIndex}`);
      if (!node || !parent) continue;
      node.winnerAdvancesToNodeId = parent.id;
      node.parentNodeId = parent.id;
      await manager.save(BracketNode, node);
    }

    return count;
  }

  private async assertGroupStageComplete(
    divisionId: string,
    stageId: string,
  ): Promise<void> {
    const open = await this.matches.count({
      where: {
        divisionId,
        stageId,
        deletedAt: IsNull(),
        status: Not(In(['approved', 'walkover', 'cancelled'])),
      },
    });
    if (open > 0) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.STAGE_NOT_READY,
        message: 'Complete all group matches before generating knockout',
      });
    }
  }

  private async resolveAdvancingTeamIds(
    divisionId: string,
    groupStageId: string,
    blueprint: StructureBlueprint,
    rules: StandingsRules,
  ): Promise<string[]> {
    const grps = await this.groups.find({ where: { stageId: groupStageId } });
    const inputs: GroupStandingInput[] = [];

    for (const g of grps) {
      const members = await this.groupMembers.find({
        where: { groupId: g.id },
      });
      const memberTeamIds = members.map((m) => m.teamId);
      const completed = await this.matches.find({
        where: {
          divisionId,
          groupId: g.id,
          status: In(['approved', 'walkover']),
          deletedAt: IsNull(),
        },
      });
      const results = completed
        .filter((m) => m.homeTeamId && m.awayTeamId)
        .map((m) => ({
          homeTeamId: m.homeTeamId!,
          awayTeamId: m.awayTeamId!,
          homeScore: m.homeScore ?? 0,
          awayScore: m.awayScore ?? 0,
        }));
      inputs.push({
        groupId: g.id,
        groupName: g.name,
        teamIds: memberTeamIds,
        results,
        rules,
      });
    }

    return pickAdvancingTeams(inputs, blueprint.advancement);
  }

  async buildStagesFromBlueprint(
    divisionId: string,
    configVersionId: string,
    structureType: string,
  ): Promise<void> {
    const stages: { order: number; name: string; stageType: string }[] = [];

    if (structureType === 'direct_knockout') {
      stages.push({ order: 1, name: 'Knockout', stageType: 'knockout' });
    } else if (structureType === 'group_only') {
      stages.push({ order: 1, name: 'Group Stage', stageType: 'group' });
    } else if (
      structureType === 'group_plus_knockout' ||
      structureType === 'qualifier_group_knockout'
    ) {
      stages.push({ order: 1, name: 'Group Stage', stageType: 'group' });
      stages.push({ order: 2, name: 'Knockout', stageType: 'knockout' });
    } else {
      stages.push({ order: 1, name: 'Stage 1', stageType: 'group' });
      stages.push({ order: 2, name: 'Stage 2', stageType: 'knockout' });
    }

    for (const s of stages) {
      await this.stages.save({
        divisionId,
        configVersionId,
        order: s.order,
        name: s.name,
        stageType: s.stageType,
        status: 'pending',
      });
    }
  }
}
