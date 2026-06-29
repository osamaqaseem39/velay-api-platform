import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Not, Repository } from 'typeorm';
import { BracketNode } from '../entities/bracket-node.entity';
import { TournamentFixture } from '../entities/tournament-fixture.entity';
import { TournamentMatch } from '../entities/tournament-match.entity';
import { TournamentStage } from '../entities/tournament-stage.entity';
import { TournamentDivision } from '../entities/tournament-division.entity';
import {
  buildNextRoundPairings,
  collectRoundWinners,
  findNextKnockoutRoundToGenerate,
  isKnockoutBracketFullyResolved,
  isKnockoutRoundComplete,
} from '../engines/knockout-round.engine';
import { TOURNAMENT_ERROR_CODES } from '../types/tournament.types';

@Injectable()
export class KnockoutBracketService {
  constructor(
    @InjectRepository(BracketNode)
    private readonly bracketNodes: Repository<BracketNode>,
    @InjectRepository(TournamentMatch)
    private readonly matches: Repository<TournamentMatch>,
    @InjectRepository(TournamentStage)
    private readonly stages: Repository<TournamentStage>,
    @InjectRepository(TournamentDivision)
    private readonly divisions: Repository<TournamentDivision>,
    @InjectRepository(TournamentFixture)
    private readonly fixtures: Repository<TournamentFixture>,
  ) {}

  async getRoundStatus(divisionId: string, stageId: string) {
    const nodes = await this.bracketNodes.find({
      where: { stageId },
      order: { round: 'ASC', slotIndex: 'ASC' },
    });
    const matchIds = nodes
      .map((n) => n.matchId)
      .filter((id): id is string => Boolean(id));
    const linkedMatches =
      matchIds.length > 0
        ? await this.matches.find({ where: { id: In(matchIds) } })
        : [];
    const matchById = new Map(linkedMatches.map((m) => [m.id, m]));
    const maxRound =
      nodes.length > 0 ? Math.max(...nodes.map((n) => n.round)) : 0;
    const rounds: {
      round: number;
      pairings: number;
      matchesGenerated: number;
      matchesResolved: number;
      isComplete: boolean;
    }[] = [];
    for (let round = 1; round <= maxRound; round++) {
      const roundNodes = nodes.filter((n) => n.round === round);
      const matchesGenerated = roundNodes.filter((n) => n.matchId).length;
      const matchesResolved = roundNodes.filter((n) => {
        if (!n.matchId) {
          return (n.isBye && Boolean(n.teamId?.trim())) ||
            (Boolean(n.teamId?.trim()) && !n.awayTeamId);
        }
        const m = matchById.get(n.matchId);
        return m != null && ['approved', 'walkover'].includes(m.status);
      }).length;
      rounds.push({
        round,
        pairings: roundNodes.length,
        matchesGenerated,
        matchesResolved,
        isComplete: isKnockoutRoundComplete(round, nodes, matchById),
      });
    }
    return {
      stageId,
      maxRound,
      rounds,
      nextRoundToGenerate: findNextKnockoutRoundToGenerate(nodes, matchById),
    };
  }

  async generateNextRound(
    divisionId: string,
    stageId: string,
    manager?: EntityManager,
  ): Promise<{ round: number; matchesCreated: number }> {
    const nodes = manager
      ? await manager.find(BracketNode, {
          where: { stageId },
          order: { round: 'ASC', slotIndex: 'ASC' },
        })
      : await this.bracketNodes.find({
          where: { stageId },
          order: { round: 'ASC', slotIndex: 'ASC' },
        });
    if (nodes.length === 0) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.INVALID_STAGE,
        message: 'Knockout bracket not found',
      });
    }

    const matchIds = nodes
      .map((n) => n.matchId)
      .filter((id): id is string => Boolean(id));
    const linkedMatches =
      matchIds.length > 0
        ? manager
          ? await manager.find(TournamentMatch, { where: { id: In(matchIds) } })
          : await this.matches.find({ where: { id: In(matchIds) } })
        : [];
    const matchById = new Map(linkedMatches.map((m) => [m.id, m]));
    const nextRound = findNextKnockoutRoundToGenerate(nodes, matchById);
    if (nextRound == null) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.STAGE_NOT_READY,
        message: 'No knockout round is ready to generate',
      });
    }

    const prevRound = nextRound - 1;
    const prevRoundNodes = nodes.filter((n) => n.round === prevRound);
    const byeTeamIds = new Set(
      prevRoundNodes
        .filter((n) => n.isBye && n.teamId?.trim())
        .map((n) => n.teamId!.trim()),
    );
    const winners = collectRoundWinners(prevRound, nodes, matchById);
    const { matches, carryTeamId } = buildNextRoundPairings(winners, byeTeamIds);
    let matchesCreated = 0;
    let slotIndex = 0;

    for (const pair of matches) {
      const match = manager
        ? await manager.save(TournamentMatch, {
            divisionId,
            stageId,
            status: 'draft',
            homeTeamId: pair.homeTeamId,
            awayTeamId: pair.awayTeamId,
          })
        : await this.matches.save({
            divisionId,
            stageId,
            status: 'draft',
            homeTeamId: pair.homeTeamId,
            awayTeamId: pair.awayTeamId,
          });
      const node = manager
        ? await manager.save(BracketNode, {
            stageId,
            round: nextRound,
            slotIndex,
            isBye: false,
            matchId: match.id,
          })
        : await this.bracketNodes.save({
            stageId,
            round: nextRound,
            slotIndex,
            isBye: false,
            matchId: match.id,
          });
      if (manager) {
        await manager.save(TournamentFixture, {
          stageId,
          round: nextRound,
          matchId: match.id,
        });
      } else {
        await this.fixtures.save({
          stageId,
          round: nextRound,
          matchId: match.id,
        });
      }
      void node;
      slotIndex += 1;
      matchesCreated += 1;
    }

    if (carryTeamId) {
      if (manager) {
        await manager.save(BracketNode, {
          stageId,
          round: nextRound,
          slotIndex,
          teamId: carryTeamId,
          isBye: true,
          matchId: null,
        });
      } else {
        await this.bracketNodes.save({
          stageId,
          round: nextRound,
          slotIndex,
          teamId: carryTeamId,
          isBye: true,
          matchId: null,
        });
      }
    }

    return { round: nextRound, matchesCreated };
  }

  async tryCompleteKnockoutStage(
    stageId: string,
    divisionId: string,
  ): Promise<void> {
    const stage = await this.stages.findOne({ where: { id: stageId } });
    if (!stage || stage.stageType !== 'knockout' || stage.status === 'completed') {
      return;
    }

    const open = await this.matches.count({
      where: {
        divisionId,
        stageId,
        deletedAt: IsNull(),
        status: Not(In(['approved', 'walkover', 'cancelled'])),
      },
    });
    if (open > 0) return;

    const playable = await this.matches.count({
      where: { divisionId, stageId, deletedAt: IsNull() },
    });
    if (playable === 0) return;

    const nodes = await this.bracketNodes.find({
      where: { stageId },
      order: { round: 'ASC', slotIndex: 'ASC' },
    });
    const matchIds = nodes
      .map((n) => n.matchId)
      .filter((id): id is string => Boolean(id));
    const linkedMatches =
      matchIds.length > 0
        ? await this.matches.find({ where: { id: In(matchIds) } })
        : [];
    const matchById = new Map(linkedMatches.map((m) => [m.id, m]));
    if (!isKnockoutBracketFullyResolved(nodes, matchById)) return;

    stage.status = 'completed';
    await this.stages.save(stage);
    await this.tryAutoCompleteDivision(divisionId);
  }

  private async tryAutoCompleteDivision(divisionId: string): Promise<void> {
    const division = await this.divisions.findOne({
      where: { id: divisionId, deletedAt: IsNull() },
    });
    if (!division || division.status !== 'in_progress') return;

    const incompleteStages = await this.stages.count({
      where: {
        divisionId,
        deletedAt: IsNull(),
        status: Not(In(['completed', 'cancelled'])),
      },
    });
    if (incompleteStages > 0) return;

    const openMatches = await this.matches.count({
      where: {
        divisionId,
        deletedAt: IsNull(),
        status: Not(In(['approved', 'walkover', 'cancelled'])),
      },
    });
    if (openMatches > 0) return;

    division.status = 'completed';
    await this.divisions.save(division);
  }
}
