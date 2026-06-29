import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Tournament } from '../entities/tournament.entity';
import { TournamentDivision } from '../entities/tournament-division.entity';
import { TournamentConfigVersion } from '../entities/tournament-config-version.entity';
import { TournamentStage } from '../entities/tournament-stage.entity';
import { TournamentMatch } from '../entities/tournament-match.entity';
import { TournamentFixture } from '../entities/tournament-fixture.entity';
import { BracketNode } from '../entities/bracket-node.entity';
import { Standing } from '../entities/standing.entity';
import { TournamentGroup } from '../entities/tournament-group.entity';
import { GroupMember } from '../entities/group-member.entity';
import { Team } from '../entities/team.entity';
import { TournamentRegistration } from '../entities/tournament-registration.entity';
import { BusinessLocation } from '../../businesses/entities/business-location.entity';
import { Business } from '../../businesses/entities/business.entity';
import {
  CreateTournamentDto,
  CreateTournamentDivisionDto,
  PreviewStructureDto,
  UpdateTournamentDto,
} from '../dto/create-tournament.dto';
import {
  ACTIVE_REGISTRATION_STATUSES,
  DEFAULT_STANDINGS_RULES,
  TOURNAMENT_ERROR_CODES,
  type TournamentStatus,
  type StructureBlueprint,
} from '../types/tournament.types';
import { previewStructure, TOURNAMENT_TEMPLATES } from '../engines/structure.engine';
import { resolveMatchWinner } from '../engines/knockout-result.engine';
import {
  assertTournamentTransition,
  tournamentEventToStatus,
} from '../state/tournament-state.machine';
import { TournamentAuditService } from './tournament-audit.service';
import { FixtureGenerationService } from './fixture-generation.service';
import { KnockoutBracketService } from './knockout-bracket.service';
import { isKnockoutBracketFullyResolved } from '../engines/knockout-round.engine';

export type TournamentDivisionRow = {
  id: string;
  tournamentId: string;
  sport: string;
  label: string | null;
  displayOrder: number;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  maxTeams: number;
  entryFeeAmount: number | null;
  entryFeeCurrency: string;
  prizePool: Record<string, unknown> | null;
  rules: string | null;
  structureType: string;
  status: string;
  currentConfigVersionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  structureBlueprint?: unknown;
};

export type TournamentRow = {
  id: string;
  eventId: string;
  tenantId: string;
  name: string;
  sport: string;
  sports: string[];
  venueIds: string[];
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  startsAt: string;
  endsAt: string | null;
  maxTeams: number;
  entryFeeAmount: number | null;
  entryFeeCurrency: string;
  prizePool: Record<string, unknown> | null;
  rules: string | null;
  structureType: string;
  status: string;
  currentConfigVersionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  structureBlueprint?: unknown;
  divisions?: TournamentDivisionRow[];
};

export type TournamentApprovalRow = TournamentRow & {
  businessName: string | null;
};

@Injectable()
export class TournamentsService {
  constructor(
    @InjectRepository(Tournament)
    private readonly tournaments: Repository<Tournament>,
    @InjectRepository(TournamentDivision)
    private readonly divisions: Repository<TournamentDivision>,
    @InjectRepository(TournamentConfigVersion)
    private readonly configs: Repository<TournamentConfigVersion>,
    @InjectRepository(TournamentStage)
    private readonly stages: Repository<TournamentStage>,
    @InjectRepository(TournamentMatch)
    private readonly matches: Repository<TournamentMatch>,
    @InjectRepository(TournamentFixture)
    private readonly fixtures: Repository<TournamentFixture>,
    @InjectRepository(BracketNode)
    private readonly bracketNodes: Repository<BracketNode>,
    @InjectRepository(Standing)
    private readonly standings: Repository<Standing>,
    @InjectRepository(TournamentGroup)
    private readonly groups: Repository<TournamentGroup>,
    @InjectRepository(GroupMember)
    private readonly groupMembers: Repository<GroupMember>,
    @InjectRepository(Team)
    private readonly teams: Repository<Team>,
    @InjectRepository(TournamentRegistration)
    private readonly registrations: Repository<TournamentRegistration>,
    @InjectRepository(BusinessLocation)
    private readonly locations: Repository<BusinessLocation>,
    @InjectRepository(Business)
    private readonly businesses: Repository<Business>,
    private readonly audit: TournamentAuditService,
    private readonly fixtureGen: FixtureGenerationService,
    private readonly knockoutBracket: KnockoutBracketService,
  ) {}

  private toDivisionRow(
    d: TournamentDivision,
    blueprint?: unknown,
  ): TournamentDivisionRow {
    return {
      id: d.id,
      tournamentId: d.tournamentId,
      sport: d.sport,
      label: d.label ?? null,
      displayOrder: d.displayOrder,
      registrationOpensAt: d.registrationOpensAt?.toISOString() ?? null,
      registrationClosesAt: d.registrationClosesAt?.toISOString() ?? null,
      maxTeams: d.maxTeams,
      entryFeeAmount:
        d.entryFeeAmount != null ? Number(d.entryFeeAmount) : null,
      entryFeeCurrency: d.entryFeeCurrency,
      prizePool: (d.prizePool as Record<string, unknown>) ?? null,
      rules: d.rules ?? null,
      structureType: d.structureType,
      status: d.status,
      currentConfigVersionId: d.currentConfigVersionId ?? null,
      version: d.version,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      structureBlueprint: blueprint,
    };
  }

  private toRow(
    event: Tournament,
    division: TournamentDivision,
    allDivisions: TournamentDivision[],
    blueprint?: unknown,
  ): TournamentRow {
    const sports = allDivisions.map((d) => d.sport);
    return {
      id: division.id,
      eventId: event.id,
      tenantId: event.tenantId,
      name: event.name,
      sport: division.sport,
      sports,
      venueIds: event.venueIds ?? [],
      registrationOpensAt: division.registrationOpensAt?.toISOString() ?? null,
      registrationClosesAt: division.registrationClosesAt?.toISOString() ?? null,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt?.toISOString() ?? null,
      maxTeams: division.maxTeams,
      entryFeeAmount:
        division.entryFeeAmount != null ? Number(division.entryFeeAmount) : null,
      entryFeeCurrency: division.entryFeeCurrency,
      prizePool: (division.prizePool as Record<string, unknown>) ?? null,
      rules: division.rules ?? null,
      structureType: division.structureType,
      status: division.status,
      currentConfigVersionId: division.currentConfigVersionId ?? null,
      version: division.version,
      createdAt: division.createdAt.toISOString(),
      updatedAt: division.updatedAt.toISOString(),
      structureBlueprint: blueprint,
      divisions: allDivisions.map((d) =>
        this.toDivisionRow(
          d,
          d.id === division.id ? blueprint : undefined,
        ),
      ),
    };
  }

  private normalizeDivisionInputs(
    dto: CreateTournamentDto,
  ): CreateTournamentDivisionDto[] {
    if (dto.divisions?.length) return dto.divisions;
    if (!dto.sport || !dto.structureType || dto.maxTeams == null) {
      throw new BadRequestException(
        'Provide divisions[] or legacy single-sport fields',
      );
    }
    return [
      {
        sport: dto.sport,
        registrationOpensAt: dto.registrationOpensAt,
        registrationClosesAt: dto.registrationClosesAt,
        maxTeams: dto.maxTeams,
        entryFeeAmount: dto.entryFeeAmount,
        entryFeeCurrency: dto.entryFeeCurrency,
        prizePool: dto.prizePool,
        rules: dto.rules,
        structureType: dto.structureType,
        advancement: dto.advancement,
        groupCount: dto.groupCount,
        minTeamsPerGroup: dto.minTeamsPerGroup,
        maxTeamsPerGroup: dto.maxTeamsPerGroup,
        matchesPerTeam: dto.matchesPerTeam,
      },
    ];
  }

  async list(tenantId: string): Promise<TournamentRow[]> {
    const events = await this.tournaments.find({
      where: { tenantId, deletedAt: IsNull() },
      order: { startsAt: 'DESC' },
    });
    if (events.length === 0) return [];

    const eventIds = events.map((e) => e.id);
    const allDivisions = await this.divisions.find({
      where: { tournamentId: In(eventIds), deletedAt: IsNull() },
      order: { displayOrder: 'ASC' },
    });
    const divisionsByEvent = new Map<string, TournamentDivision[]>();
    for (const d of allDivisions) {
      const list = divisionsByEvent.get(d.tournamentId) ?? [];
      list.push(d);
      divisionsByEvent.set(d.tournamentId, list);
    }

    const rows: TournamentRow[] = [];
    for (const event of events) {
      const divs = divisionsByEvent.get(event.id) ?? [];
      for (const division of divs) {
        rows.push(this.toRow(event, division, divs));
      }
    }
    return rows;
  }

  async get(tenantId: string, id: string): Promise<TournamentRow> {
    const { event, division, divisions } = await this.findDivisionContext(
      tenantId,
      id,
    );
    let blueprint: unknown;
    if (division.currentConfigVersionId) {
      const cfg = await this.configs.findOne({
        where: { id: division.currentConfigVersionId },
      });
      blueprint = cfg?.structureBlueprint;
    }
    return this.toRow(event, division, divisions, blueprint);
  }

  async getEvent(tenantId: string, eventId: string) {
    const event = await this.tournaments.findOne({
      where: { id: eventId, tenantId, deletedAt: IsNull() },
    });
    if (!event) throw new NotFoundException('Tournament event not found');

    const divisions = await this.divisions.find({
      where: { tournamentId: eventId, deletedAt: IsNull() },
      order: { displayOrder: 'ASC' },
    });
    if (divisions.length === 0) {
      throw new NotFoundException('Tournament has no divisions');
    }

    const divisionRows: TournamentDivisionRow[] = [];
    for (const d of divisions) {
      let blueprint: unknown;
      if (d.currentConfigVersionId) {
        const cfg = await this.configs.findOne({
          where: { id: d.currentConfigVersionId },
        });
        blueprint = cfg?.structureBlueprint;
      }
      divisionRows.push(this.toDivisionRow(d, blueprint));
    }

    return {
      id: event.id,
      tenantId: event.tenantId,
      name: event.name,
      venueIds: event.venueIds ?? [],
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt?.toISOString() ?? null,
      sports: divisions.map((d) => d.sport),
      divisions: divisionRows,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    };
  }

  async create(
    tenantId: string,
    dto: CreateTournamentDto,
    actorId?: string,
  ): Promise<TournamentRow> {
    const divisionInputs = this.normalizeDivisionInputs(dto);
    const sports = divisionInputs.map((d) => d.sport.trim().toLowerCase());
    if (new Set(sports).size !== sports.length) {
      throw new BadRequestException('Each sport may only appear once per event');
    }

    const event = await this.tournaments.save({
      tenantId,
      name: dto.name,
      venueIds: dto.venueIds,
      startsAt: new Date(dto.startsAt),
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
    });

    let firstDivision: TournamentDivision | null = null;

    for (let i = 0; i < divisionInputs.length; i++) {
      const divDto = divisionInputs[i]!;
      let blueprint;
      try {
        blueprint = previewStructure({
          teamCount: divDto.maxTeams,
          structureType: divDto.structureType,
          advancement: divDto.advancement,
          groupCount: divDto.groupCount,
          minTeamsPerGroup: divDto.minTeamsPerGroup,
          maxTeamsPerGroup: divDto.maxTeamsPerGroup,
          matchesPerTeam: divDto.matchesPerTeam,
        });
      } catch (e) {
        throw new BadRequestException(
          e instanceof Error ? e.message : 'Invalid tournament structure',
        );
      }

      const division = await this.divisions.save({
        tournamentId: event.id,
        sport: divDto.sport,
        label: divDto.label ?? null,
        displayOrder: i,
        registrationOpensAt: divDto.registrationOpensAt
          ? new Date(divDto.registrationOpensAt)
          : null,
        registrationClosesAt: divDto.registrationClosesAt
          ? new Date(divDto.registrationClosesAt)
          : null,
        maxTeams: divDto.maxTeams,
        entryFeeAmount:
          divDto.entryFeeAmount != null ? String(divDto.entryFeeAmount) : null,
        entryFeeCurrency: divDto.entryFeeCurrency ?? 'PKR',
        prizePool: divDto.prizePool ?? null,
        rules: divDto.rules ?? null,
        structureType: divDto.structureType,
        status: 'pending_approval',
      });

      const config = await this.configs.save({
        divisionId: division.id,
        version: 1,
        structureBlueprint: blueprint,
        standingsRules: DEFAULT_STANDINGS_RULES,
        seedingMode: 'ranking',
        advancementRules: divDto.advancement ? [divDto.advancement] : [],
      });

      division.currentConfigVersionId = config.id;
      await this.divisions.save(division);

      await this.fixtureGen.buildStagesFromBlueprint(
        division.id,
        config.id,
        divDto.structureType,
      );

      if (!firstDivision) firstDivision = division;
    }

    await this.audit.log({
      tenantId,
      entityType: 'tournament',
      entityId: event.id,
      actorId,
      afterState: {
        status: 'pending_approval',
        name: event.name,
        sports: divisionInputs.map((d) => d.sport),
      },
    });

    return this.get(tenantId, firstDivision!.id);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTournamentDto,
    actorId?: string,
  ): Promise<TournamentRow> {
    const { event, division } = await this.findDivisionContext(tenantId, id);
    const limited = division.status === 'in_progress';
    const editable =
      division.status === 'pending_approval' ||
      division.status === 'rejected' ||
      division.status === 'draft' ||
      division.status === 'published' ||
      division.status === 'registration_open' ||
      division.status === 'registration_closed' ||
      division.status === 'ready' ||
      limited;
    if (!editable) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.TOURNAMENT_INVALID_STATE,
        message: 'Tournament settings cannot be edited in this state',
      });
    }
    if (dto.version != null && dto.version !== division.version) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.CONFLICT_RETRY,
        message: 'Version conflict',
      });
    }

    if (limited) {
      const restricted = [
        dto.sport,
        dto.venueIds,
        dto.registrationOpensAt,
        dto.registrationClosesAt,
        dto.startsAt,
        dto.maxTeams,
        dto.entryFeeAmount,
        dto.structureType,
        dto.advancement,
        dto.groupCount,
        dto.minTeamsPerGroup,
        dto.maxTeamsPerGroup,
        dto.matchesPerTeam,
      ].some((v) => v !== undefined);
      if (restricted) {
        throw new ConflictException({
          code: TOURNAMENT_ERROR_CODES.TOURNAMENT_INVALID_STATE,
          message:
            'Only name, rules, and end date can be changed while in progress',
        });
      }
    }

    if (dto.maxTeams != null && !limited) {
      const activeCount = await this.registrations.count({
        where: {
          divisionId: id,
          status: In([...ACTIVE_REGISTRATION_STATUSES]),
          deletedAt: IsNull(),
        },
      });
      if (dto.maxTeams < activeCount) {
        throw new ConflictException({
          code: TOURNAMENT_ERROR_CODES.REGISTRATION_FULL,
          message: `Max teams cannot be below current registrations (${activeCount})`,
        });
      }
    }

    const hasStructureChange =
      dto.structureType != null ||
      dto.advancement != null ||
      dto.groupCount != null ||
      dto.minTeamsPerGroup != null ||
      dto.maxTeamsPerGroup != null ||
      dto.matchesPerTeam != null;

    const stageList = await this.stages.find({
      where: { divisionId: id, deletedAt: IsNull() },
    });
    const structureLocked = stageList.some((s) => s.status !== 'pending');

    if (hasStructureChange && !limited && structureLocked) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.BRACKET_LOCKED,
        message: 'Structure cannot be changed after stages are generated',
      });
    }

    const before = { event: { ...event }, division: { ...division } };

    if (dto.name != null) event.name = dto.name;
    if (!limited) {
      if (dto.sport != null) division.sport = dto.sport;
      if (dto.venueIds != null) event.venueIds = dto.venueIds;
      if (dto.registrationOpensAt != null)
        division.registrationOpensAt = new Date(dto.registrationOpensAt);
      if (dto.registrationClosesAt != null)
        division.registrationClosesAt = new Date(dto.registrationClosesAt);
      if (dto.startsAt != null) event.startsAt = new Date(dto.startsAt);
      if (dto.maxTeams != null) division.maxTeams = dto.maxTeams;
      if (dto.entryFeeAmount != null)
        division.entryFeeAmount = String(dto.entryFeeAmount);
    }
    if (dto.endsAt != null) event.endsAt = new Date(dto.endsAt);
    if (dto.rules != null) division.rules = dto.rules;
    if (dto.prizePool != null) division.prizePool = dto.prizePool;

    if (
      (hasStructureChange || dto.maxTeams != null) &&
      !limited &&
      !structureLocked &&
      division.currentConfigVersionId
    ) {
      const config = await this.configs.findOne({
        where: { id: division.currentConfigVersionId },
      });
      if (config) {
        const existing = config.structureBlueprint as StructureBlueprint;
        const advancement =
          dto.advancement ??
          (config.advancementRules?.[0] as Record<string, unknown> | undefined);
        let blueprint;
        try {
          blueprint = previewStructure({
            teamCount: dto.maxTeams ?? division.maxTeams,
            structureType: dto.structureType ?? division.structureType,
            advancement,
            groupCount: dto.groupCount ?? existing.groupStage?.groupCount,
            minTeamsPerGroup:
              dto.minTeamsPerGroup ?? existing.groupStage?.minTeamsPerGroup,
            maxTeamsPerGroup:
              dto.maxTeamsPerGroup ?? existing.groupStage?.maxTeamsPerGroup,
            matchesPerTeam:
              dto.matchesPerTeam ?? existing.groupStage?.matchesPerTeam,
          });
        } catch (e) {
          throw new BadRequestException(
            e instanceof Error ? e.message : 'Invalid tournament structure',
          );
        }
        config.structureBlueprint = blueprint;
        if (dto.advancement) config.advancementRules = [dto.advancement];
        await this.configs.save(config);
        if (dto.structureType != null)
          division.structureType = dto.structureType;
      }
    }

    division.version += 1;
    await this.tournaments.save(event);
    await this.divisions.save(division);

    await this.audit.log({
      tenantId,
      entityType: 'tournament_division',
      entityId: id,
      actorId,
      beforeState: before as unknown as Record<string, unknown>,
      afterState: { event, division } as unknown as Record<string, unknown>,
    });

    return this.get(tenantId, id);
  }

  private async assertDivisionReadyToComplete(divisionId: string): Promise<void> {
    const incompleteStages = await this.stages.count({
      where: {
        divisionId,
        deletedAt: IsNull(),
        status: Not(In(['completed', 'cancelled'])),
      },
    });
    if (incompleteStages > 0) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.STAGE_NOT_READY,
        message:
          'All tournament stages must be completed before finishing the tournament',
      });
    }

    const openMatches = await this.matches.count({
      where: {
        divisionId,
        deletedAt: IsNull(),
        status: Not(In(['approved', 'walkover', 'cancelled'])),
      },
    });
    if (openMatches > 0) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.STAGE_NOT_READY,
        message:
          'All matches must be approved, walkovers, or cancelled before finishing',
      });
    }

    await this.assertKnockoutBracketsResolved(divisionId);
  }

  private async assertKnockoutBracketsResolved(divisionId: string): Promise<void> {
    const knockoutStages = await this.stages.find({
      where: {
        divisionId,
        stageType: 'knockout',
        deletedAt: IsNull(),
        status: Not(In(['cancelled', 'pending', 'generating'])),
      },
    });
    for (const stage of knockoutStages) {
      const nodes = await this.bracketNodes.find({
        where: { stageId: stage.id },
        order: { round: 'ASC', slotIndex: 'ASC' },
      });
      if (nodes.length === 0) continue;
      const matchIds = nodes
        .map((n) => n.matchId)
        .filter((id): id is string => Boolean(id));
      const linkedMatches =
        matchIds.length > 0
          ? await this.matches.find({ where: { id: In(matchIds) } })
          : [];
      const matchById = new Map(linkedMatches.map((m) => [m.id, m]));
      if (!isKnockoutBracketFullyResolved(nodes, matchById)) {
        throw new ConflictException({
          code: TOURNAMENT_ERROR_CODES.STAGE_NOT_READY,
          message:
            'Knockout is not finished — generate remaining rounds and approve every match before completing',
        });
      }
    }
  }

  async transition(
    tenantId: string,
    id: string,
    eventName: string,
    actorId?: string,
  ): Promise<TournamentRow> {
    const { division } = await this.findDivisionContext(tenantId, id);
    const next = tournamentEventToStatus(eventName);
    if (!next) {
      throw new ConflictException('Unknown transition event');
    }
    assertTournamentTransition(division.status as TournamentStatus, next);

    if (eventName === 'complete') {
      await this.assertDivisionReadyToComplete(id);
    }

    if (eventName === 'start') {
      const config = await this.configs.findOne({
        where: { id: division.currentConfigVersionId! },
      });
      if (config && !config.lockedAt) {
        config.lockedAt = new Date();
        config.lockedByUserId = actorId ?? null;
        await this.configs.save(config);
      }
    }

    const before = division.status;
    division.status = next;
    division.version += 1;
    await this.divisions.save(division);

    await this.audit.log({
      tenantId,
      entityType: 'tournament_division',
      entityId: id,
      actorId,
      reason: eventName,
      beforeState: { status: before },
      afterState: { status: next },
    });

    return this.get(tenantId, id);
  }

  async listPendingApproval(): Promise<TournamentApprovalRow[]> {
    const divisions = await this.divisions.find({
      where: { status: 'pending_approval', deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    if (divisions.length === 0) return [];

    const eventIds = [...new Set(divisions.map((d) => d.tournamentId))];
    const events = await this.tournaments.find({
      where: { id: In(eventIds), deletedAt: IsNull() },
    });
    const eventById = new Map(events.map((e) => [e.id, e]));

    const tenantIds = [...new Set(events.map((e) => e.tenantId))];
    const businesses = await this.businesses.find({
      where: { tenantId: In(tenantIds) },
    });
    const businessByTenant = new Map(
      businesses.map((b) => [b.tenantId, b.businessName]),
    );

    const rows: TournamentApprovalRow[] = [];
    for (const division of divisions) {
      const event = eventById.get(division.tournamentId);
      if (!event) continue;
      const allDivisions = await this.divisions.find({
        where: { tournamentId: event.id, deletedAt: IsNull() },
        order: { displayOrder: 'ASC' },
      });
      rows.push({
        ...(await this.toApprovalRow(event, division, allDivisions)),
        businessName: businessByTenant.get(event.tenantId) ?? null,
      });
    }
    return rows;
  }

  async approveByPlatform(
    divisionId: string,
    actorId?: string,
  ): Promise<TournamentApprovalRow> {
    const { event, division, divisions } =
      await this.findDivisionById(divisionId);
    assertTournamentTransition(division.status as TournamentStatus, 'draft');
    const before = division.status;
    division.status = 'draft';
    division.version += 1;
    await this.divisions.save(division);

    await this.audit.log({
      tenantId: event.tenantId,
      entityType: 'tournament_division',
      entityId: divisionId,
      actorId,
      reason: 'approve',
      beforeState: { status: before },
      afterState: { status: 'draft' },
    });

    return this.toApprovalRow(event, division, divisions);
  }

  async rejectByPlatform(
    divisionId: string,
    reason: string | undefined,
    actorId?: string,
  ): Promise<TournamentApprovalRow> {
    const { event, division, divisions } =
      await this.findDivisionById(divisionId);
    assertTournamentTransition(division.status as TournamentStatus, 'rejected');
    const before = division.status;
    division.status = 'rejected';
    division.version += 1;
    await this.divisions.save(division);

    await this.audit.log({
      tenantId: event.tenantId,
      entityType: 'tournament_division',
      entityId: divisionId,
      actorId,
      reason: reason?.trim() || 'reject',
      beforeState: { status: before },
      afterState: { status: 'rejected' },
    });

    return this.toApprovalRow(event, division, divisions);
  }

  private async toApprovalRow(
    event: Tournament,
    division: TournamentDivision,
    divisions: TournamentDivision[],
  ): Promise<TournamentApprovalRow> {
    const business = await this.businesses.findOne({
      where: { tenantId: event.tenantId },
    });
    let blueprint: unknown;
    if (division.currentConfigVersionId) {
      const cfg = await this.configs.findOne({
        where: { id: division.currentConfigVersionId },
      });
      blueprint = cfg?.structureBlueprint;
    }
    return {
      ...this.toRow(event, division, divisions, blueprint),
      businessName: business?.businessName ?? null,
    };
  }

  private async findDivisionById(divisionId: string) {
    const division = await this.divisions.findOne({
      where: { id: divisionId, deletedAt: IsNull() },
    });
    if (!division) throw new NotFoundException('Tournament division not found');

    const event = await this.tournaments.findOne({
      where: { id: division.tournamentId, deletedAt: IsNull() },
    });
    if (!event) throw new NotFoundException('Tournament event not found');

    const divisions = await this.divisions.find({
      where: { tournamentId: event.id, deletedAt: IsNull() },
      order: { displayOrder: 'ASC' },
    });

    return { event, division, divisions };
  }

  private async findDivisionContext(tenantId: string, divisionId: string) {
    const ctx = await this.findDivisionById(divisionId);
    if (ctx.event.tenantId !== tenantId) {
      throw new NotFoundException('Tournament not found');
    }
    return ctx;
  }

  previewStructure(dto: PreviewStructureDto) {
    try {
      return previewStructure({
        teamCount: dto.teamCount,
        structureType: dto.structureType,
        advancement: dto.advancement,
        groupCount: dto.groupCount,
        minTeamsPerGroup: dto.minTeamsPerGroup,
        maxTeamsPerGroup: dto.maxTeamsPerGroup,
        matchesPerTeam: dto.matchesPerTeam,
      });
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Invalid tournament structure',
      );
    }
  }

  getTemplates() {
    return TOURNAMENT_TEMPLATES;
  }

  async generateStage(tenantId: string, id: string, stageOrder: number) {
    await this.findDivisionContext(tenantId, id);
    return this.fixtureGen.generateStage(id, stageOrder);
  }

  async resetStage(tenantId: string, id: string, stageOrder: number) {
    await this.findDivisionContext(tenantId, id);
    return this.fixtureGen.resetStage(id, stageOrder);
  }

  async generateKnockoutRound(tenantId: string, id: string, stageOrder: number) {
    await this.findDivisionContext(tenantId, id);
    return this.fixtureGen.generateKnockoutRound(id, stageOrder);
  }

  async getKnockoutRoundStatus(tenantId: string, id: string) {
    await this.findDivisionContext(tenantId, id);
    const knockoutStages = await this.stages.find({
      where: { divisionId: id, stageType: 'knockout', deletedAt: IsNull() },
      order: { order: 'ASC' },
    });
    if (knockoutStages.length === 0) {
      return { stages: [] };
    }
    const stages: {
      stageId: string;
      maxRound: number;
      rounds: {
        round: number;
        pairings: number;
        matchesGenerated: number;
        matchesResolved: number;
        isComplete: boolean;
      }[];
      nextRoundToGenerate: number | null;
      stageOrder: number;
      stageName: string;
    }[] = [];
    for (const stage of knockoutStages) {
      stages.push({
        ...(await this.knockoutBracket.getRoundStatus(id, stage.id)),
        stageOrder: stage.order,
        stageName: stage.name,
      });
    }
    return { stages };
  }

  async swapGroupTeams(
    tenantId: string,
    divisionId: string,
    teamIdA: string,
    teamIdB: string,
  ) {
    await this.findDivisionContext(tenantId, divisionId);
    return this.fixtureGen.swapGroupTeams(divisionId, teamIdA, teamIdB);
  }

  async getStages(tenantId: string, divisionId: string) {
    await this.findDivisionContext(tenantId, divisionId);
    return this.stages.find({
      where: { divisionId, deletedAt: IsNull() },
      order: { order: 'ASC' },
    });
  }

  async getFixtures(tenantId: string, divisionId: string) {
    await this.findDivisionContext(tenantId, divisionId);
    const stageList = await this.stages.find({ where: { divisionId } });
    const stageIds = stageList.map((s) => s.id);
    if (stageIds.length === 0) return [];
    return this.fixtures
      .createQueryBuilder('f')
      .where('f.stageId IN (:...stageIds)', { stageIds })
      .orderBy('f.round', 'ASC')
      .getMany();
  }

  private async resolveTeamNames(
    divisionId: string,
    teamIds: string[],
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (teamIds.length === 0) return names;

    const teams = await this.teams.find({ where: { id: In(teamIds) } });
    for (const team of teams) names.set(team.id, team.name);

    const missing = teamIds.filter((id) => !names.has(id));
    if (missing.length === 0) return names;

    const registrations = await this.registrations.find({
      where: { divisionId, teamId: In(missing), deletedAt: IsNull() },
    });
    const regTeamIds = registrations.map((r) => r.teamId);
    if (regTeamIds.length > 0) {
      const regTeams = await this.teams.find({ where: { id: In(regTeamIds) } });
      for (const team of regTeams) {
        if (!names.has(team.id)) names.set(team.id, team.name);
      }
    }

    return names;
  }

  async getMatches(tenantId: string, divisionId: string) {
    await this.findDivisionContext(tenantId, divisionId);
    const rows = await this.matches.find({
      where: { divisionId, deletedAt: IsNull() },
      order: { scheduledAt: 'ASC' },
    });
    const teamIds = new Set<string>();
    for (const m of rows) {
      if (m.homeTeamId) teamIds.add(m.homeTeamId);
      if (m.awayTeamId) teamIds.add(m.awayTeamId);
    }
    const teamNames = await this.resolveTeamNames(divisionId, [...teamIds]);

    return rows.map((m) => ({
      id: m.id,
      tournamentId: m.divisionId,
      stageId: m.stageId,
      groupId: m.groupId ?? null,
      status: m.status,
      scheduledAt: m.scheduledAt?.toISOString() ?? null,
      venueId: m.venueId ?? null,
      courtKind: m.courtKind ?? null,
      courtId: m.courtId ?? null,
      homeTeamId: m.homeTeamId ?? null,
      awayTeamId: m.awayTeamId ?? null,
      homeTeamName: m.homeTeamId
        ? (teamNames.get(m.homeTeamId) ?? null)
        : null,
      awayTeamName: m.awayTeamId
        ? (teamNames.get(m.awayTeamId) ?? null)
        : null,
      homeScore: m.homeScore ?? null,
      awayScore: m.awayScore ?? null,
      version: m.version,
    }));
  }

  async getStandings(tenantId: string, divisionId: string) {
    await this.findDivisionContext(tenantId, divisionId);
    const stageList = await this.stages.find({
      where: { divisionId, stageType: 'group' },
    });
    const out: { groupId: string; groupName: string; standings: Standing[] }[] =
      [];
    for (const stage of stageList) {
      const grps = await this.groups.find({ where: { stageId: stage.id } });
      for (const g of grps) {
        const rows = await this.standings.find({
          where: { groupId: g.id },
          order: { rank: 'ASC', points: 'DESC' },
        });
        out.push({ groupId: g.id, groupName: g.name, standings: rows });
      }
    }
    return out;
  }

  async getBracket(tenantId: string, divisionId: string) {
    await this.findDivisionContext(tenantId, divisionId);
    const knockoutStages = await this.stages.find({
      where: { divisionId, stageType: 'knockout' },
    });
    const nodes: BracketNode[] = [];
    for (const s of knockoutStages) {
      const stageNodes = await this.bracketNodes.find({
        where: { stageId: s.id },
        order: { round: 'ASC', slotIndex: 'ASC' },
      });
      nodes.push(...stageNodes);
    }

    const teamIds = [
      ...new Set(
        nodes.map((n) => n.teamId).filter((id): id is string => Boolean(id)),
      ),
    ];
    const matchIds = [
      ...new Set(
        nodes.map((n) => n.matchId).filter((id): id is string => Boolean(id)),
      ),
    ];
    const teamNames = await this.resolveTeamNames(divisionId, teamIds);
    const linkedMatches =
      matchIds.length > 0
        ? await this.matches.find({ where: { id: In(matchIds) } })
        : [];
    const matchById = new Map(linkedMatches.map((m) => [m.id, m]));
    const matchTeamIds = new Set<string>();
    for (const m of linkedMatches) {
      if (m.homeTeamId) matchTeamIds.add(m.homeTeamId);
      if (m.awayTeamId) matchTeamIds.add(m.awayTeamId);
    }
    const matchTeamNames = await this.resolveTeamNames(divisionId, [
      ...matchTeamIds,
    ]);

    return nodes.map((n) => {
      const match = n.matchId ? matchById.get(n.matchId) : null;
      const homeTeamId = match?.homeTeamId ?? n.teamId ?? null;
      const awayTeamId = match?.awayTeamId ?? null;
      const winnerTeamId = match ? resolveMatchWinner(match) : null;
      return {
      id: n.id,
      stageId: n.stageId,
      round: n.round,
      slotIndex: n.slotIndex,
      parentNodeId: n.parentNodeId ?? null,
      teamId: n.teamId ?? null,
      teamName: n.teamId ? (teamNames.get(n.teamId) ?? null) : null,
      homeTeamId,
      awayTeamId,
      homeTeamName: homeTeamId ? (matchTeamNames.get(homeTeamId) ?? null) : null,
      awayTeamName: awayTeamId ? (matchTeamNames.get(awayTeamId) ?? null) : null,
      homeScore: match?.homeScore ?? null,
      awayScore: match?.awayScore ?? null,
      winnerTeamId,
      winnerTeamName: winnerTeamId
        ? (matchTeamNames.get(winnerTeamId) ?? null)
        : null,
      matchStatus: match?.status ?? null,
      isBye: n.isBye,
      winnerAdvancesToNodeId: n.winnerAdvancesToNodeId ?? null,
      matchId: n.matchId ?? null,
      bracketVersion: n.bracketVersion,
    };
    });
  }

  async getKnockoutResults(tenantId: string, tournamentId: string) {
    const nodes = await this.getBracket(tenantId, tournamentId);
    if (nodes.length === 0) {
      return { champion: null, results: [] };
    }
    const maxRound = Math.max(...nodes.map((n) => n.round));
    const results = nodes
      .filter(
        (n) =>
          n.matchId &&
          n.matchStatus &&
          ['approved', 'walkover', 'completed'].includes(n.matchStatus),
      )
      .map((n) => ({
        round: n.round,
        matchId: n.matchId,
        homeTeamId: n.homeTeamId,
        homeTeamName: n.homeTeamName,
        awayTeamId: n.awayTeamId,
        awayTeamName: n.awayTeamName,
        homeScore: n.homeScore,
        awayScore: n.awayScore,
        winnerTeamId: n.winnerTeamId,
        winnerTeamName: n.winnerTeamName,
        matchStatus: n.matchStatus,
      }))
      .sort((a, b) => a.round - b.round);
    const final = results.find((r) => r.round === maxRound && r.winnerTeamId);
    return {
      champion: final?.winnerTeamId
        ? {
            teamId: final.winnerTeamId,
            teamName: final.winnerTeamName,
          }
        : null,
      results,
    };
  }

  async listPublic(
    tenantId: string,
    opts?: { sport?: string; status?: string; page?: number; limit?: number },
  ) {
    const page = Math.max(1, opts?.page ?? 1);
    const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
    const defaultStatuses = ['registration_open', 'in_progress', 'published'];
    const statuses = opts?.status
      ? opts.status.split(',').map((s) => s.trim()).filter(Boolean)
      : defaultStatuses;

    const qb = this.divisions
      .createQueryBuilder('d')
      .innerJoin(Tournament, 't', 't.id = d.tournamentId')
      .where('t.tenantId = :tenantId', { tenantId })
      .andWhere('t.deletedAt IS NULL')
      .andWhere('d.deletedAt IS NULL')
      .andWhere('d.status IN (:...statuses)', { statuses });

    if (opts?.sport?.trim()) {
      qb.andWhere('d.sport = :sport', { sport: opts.sport.trim() });
    }

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('t.startsAt', 'ASC')
      .addOrderBy('d.displayOrder', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const items = await Promise.all(
      rows.map((d) => this.toPublicSummaryForDivision(d)),
    );
    return { items, page, limit, total };
  }

  async getPublic(tenantId: string, id: string) {
    const { event, division } = await this.findDivisionContext(tenantId, id);
    const summary = await this.toPublicSummary(event, division);
    const stageRows = await this.stages.find({
      where: { divisionId: id, deletedAt: IsNull() },
      order: { order: 'ASC' },
    });
    return {
      ...summary,
      eventId: event.id,
      stages: stageRows.map((s) => ({
        id: s.id,
        order: s.order,
        name: s.name,
        stageType: s.stageType,
        status: s.status,
      })),
    };
  }

  private async toPublicSummaryForDivision(division: TournamentDivision) {
    const event = await this.tournaments.findOne({
      where: { id: division.tournamentId, deletedAt: IsNull() },
    });
    if (!event) throw new NotFoundException('Tournament event not found');
    return this.toPublicSummary(event, division);
  }

  private async toPublicSummary(
    event: Tournament,
    division: TournamentDivision,
  ) {
    const approvedTeamsCount = await this.registrations.count({
      where: {
        divisionId: division.id,
        status: 'approved' as const,
        deletedAt: IsNull(),
      },
    });
    const activeTeamsCount = await this.registrations.count({
      where: {
        divisionId: division.id,
        status: In(['pending', 'approved', 'waitlisted']),
        deletedAt: IsNull(),
      },
    });
    const venueNames: string[] = [];
    if (event.venueIds?.length) {
      const locs = await this.locations.find({
        where: { id: In(event.venueIds) },
        select: ['id', 'name'],
      });
      venueNames.push(...locs.map((l) => l.name));
    }
    return {
      id: division.id,
      eventId: event.id,
      name: event.name,
      sport: division.sport,
      status: division.status,
      venueIds: event.venueIds ?? [],
      venueNames,
      registrationOpensAt: division.registrationOpensAt?.toISOString() ?? null,
      registrationClosesAt: division.registrationClosesAt?.toISOString() ?? null,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt?.toISOString() ?? null,
      maxTeams: division.maxTeams,
      approvedTeamsCount,
      activeTeamsCount,
      spotsRemaining: Math.max(0, division.maxTeams - activeTeamsCount),
      entryFeeAmount:
        division.entryFeeAmount != null ? Number(division.entryFeeAmount) : null,
      entryFeeCurrency: division.entryFeeCurrency,
      structureType: division.structureType,
      rules: division.rules ?? null,
      prizePool: (division.prizePool as Record<string, unknown>) ?? null,
    };
  }

  async getPublicStandings(tenantId: string, divisionId: string) {
    await this.findDivisionContext(tenantId, divisionId);
    const raw = await this.getStandings(tenantId, divisionId);
    const teamIds = new Set<string>();
    for (const g of raw) {
      for (const s of g.standings) teamIds.add(s.teamId);
    }
    const teams =
      teamIds.size > 0
        ? await this.teams.find({ where: { id: In([...teamIds]) } })
        : [];
    const teamNames = new Map(teams.map((t) => [t.id, t.name]));

    return raw.map((g) => ({
      groupId: g.groupId,
      groupName: g.groupName,
      standings: g.standings.map((s) => ({
        teamId: s.teamId,
        teamName: teamNames.get(s.teamId) ?? null,
        played: s.played,
        won: s.won,
        drawn: s.drawn,
        lost: s.lost,
        goalsFor: s.goalsFor,
        goalsAgainst: s.goalsAgainst,
        goalDifference: s.goalsFor - s.goalsAgainst,
        points: s.points,
        rank: s.rank ?? null,
      })),
    }));
  }

  async getPublicBracket(tenantId: string, divisionId: string) {
    await this.findDivisionContext(tenantId, divisionId);
    const knockoutStages = await this.stages.find({
      where: { divisionId, stageType: 'knockout', deletedAt: IsNull() },
      order: { order: 'ASC' },
    });

    const matchIds = new Set<string>();
    const stagesOut: {
      stageId: string;
      stageName: string;
      nodes: unknown[];
    }[] = [];

    for (const stage of knockoutStages) {
      const nodes = await this.bracketNodes.find({
        where: { stageId: stage.id },
        order: { round: 'ASC', slotIndex: 'ASC' },
      });
      for (const n of nodes) {
        if (n.matchId) matchIds.add(n.matchId);
      }

      const teamIds = [
        ...new Set(nodes.map((n) => n.teamId).filter(Boolean) as string[]),
      ];
      const teams =
        teamIds.length > 0
          ? await this.teams.find({ where: { id: In(teamIds) } })
          : [];
      const teamNames = new Map(teams.map((t) => [t.id, t.name]));

      stagesOut.push({
        stageId: stage.id,
        stageName: stage.name,
        nodes: nodes.map((n) => ({
          id: n.id,
          round: n.round,
          slotIndex: n.slotIndex,
          matchId: n.matchId ?? null,
          homeTeamId: n.teamId ?? null,
          awayTeamId: null,
          homeTeamName: n.teamId ? (teamNames.get(n.teamId) ?? null) : null,
          awayTeamName: null,
          winnerTeamId: null,
          nextNodeId: n.winnerAdvancesToNodeId ?? null,
        })),
      });
    }

    if (matchIds.size > 0) {
      const matches = await this.matches.find({
        where: { id: In([...matchIds]) },
      });
      const matchMap = new Map(matches.map((m) => [m.id, m]));
      for (const stage of stagesOut) {
        for (const node of stage.nodes as Array<Record<string, unknown>>) {
          const match = node.matchId
            ? matchMap.get(node.matchId as string)
            : null;
          if (match) {
            node.homeTeamId = match.homeTeamId;
            node.awayTeamId = match.awayTeamId;
            node.homeTeamName = null;
            node.awayTeamName = null;
          }
        }
      }
    }

    return { stages: stagesOut };
  }
}
