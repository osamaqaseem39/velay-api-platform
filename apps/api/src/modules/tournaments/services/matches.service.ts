import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { TournamentStage } from '../entities/tournament-stage.entity';
import { BookingItem } from '../../bookings/entities/booking-item.entity';
import { TournamentMatch } from '../entities/tournament-match.entity';
import { Tournament } from '../entities/tournament.entity';
import { TournamentDivision } from '../entities/tournament-division.entity';
import { Standing } from '../entities/standing.entity';
import { TournamentGroup } from '../entities/tournament-group.entity';
import { Team } from '../entities/team.entity';
import {
  ScheduleMatchDto,
  SubmitScoreDto,
  UpdateMatchStatusDto,
  WalkoverMatchDto,
} from '../dto/match-ops.dto';
import { TOURNAMENT_ERROR_CODES } from '../types/tournament.types';
import { assertMatchTransition } from '../state/tournament-state.machine';
import type { MatchStatus } from '../types/tournament.types';
import {
  computeStandings,
  type MatchResultInput,
} from '../engines/standings.engine';
import { DEFAULT_STANDINGS_RULES } from '../types/tournament.types';
import { TournamentAuditService } from './tournament-audit.service';
import { TournamentConfigVersion } from '../entities/tournament-config-version.entity';
import { TournamentFixture } from '../entities/tournament-fixture.entity';
import { TournamentMatchBookingService } from './tournament-match-booking.service';
import { KnockoutBracketService } from './knockout-bracket.service';
import { normalizeCourtKind } from '../utils/court-kind.util';

const DEFAULT_MATCH_DURATION_MINUTES = 60;

@Injectable()
export class MatchesService {
  constructor(
    @InjectRepository(TournamentMatch)
    private readonly matches: Repository<TournamentMatch>,
    @InjectRepository(BookingItem)
    private readonly bookingItems: Repository<BookingItem>,
    @InjectRepository(Tournament)
    private readonly tournaments: Repository<Tournament>,
    @InjectRepository(TournamentDivision)
    private readonly divisions: Repository<TournamentDivision>,
    @InjectRepository(Standing)
    private readonly standings: Repository<Standing>,
    @InjectRepository(TournamentGroup)
    private readonly groups: Repository<TournamentGroup>,
    @InjectRepository(TournamentConfigVersion)
    private readonly configs: Repository<TournamentConfigVersion>,
    @InjectRepository(TournamentStage)
    private readonly stages: Repository<TournamentStage>,
    @InjectRepository(TournamentFixture)
    private readonly fixtures: Repository<TournamentFixture>,
    @InjectRepository(Team)
    private readonly teams: Repository<Team>,
    private readonly audit: TournamentAuditService,
    private readonly matchBooking: TournamentMatchBookingService,
    private readonly knockoutBracket: KnockoutBracketService,
  ) {}

  async get(tenantId: string, matchId: string) {
    const match = await this.findMatch(tenantId, matchId);
    const { event } = await this.findDivisionContext(
      tenantId,
      match.divisionId,
    );

    const stage = await this.stages.findOne({ where: { id: match.stageId } });
    let groupName: string | null = null;
    if (match.groupId) {
      const group = await this.groups.findOne({ where: { id: match.groupId } });
      groupName = group?.name ?? null;
    }

    const teamIds = [match.homeTeamId, match.awayTeamId].filter(
      (id): id is string => Boolean(id),
    );
    const teams =
      teamIds.length > 0
        ? await this.teams.find({ where: { id: In(teamIds) } })
        : [];
    const teamNames = new Map(teams.map((t) => [t.id, t.name]));

    const fixture = await this.fixtures.findOne({ where: { matchId: match.id } });

    return {
      id: match.id,
      tournamentId: match.divisionId,
      tournamentName: event.name,
      stageId: match.stageId,
      stageName: stage?.name ?? null,
      stageType: stage?.stageType ?? null,
      groupId: match.groupId ?? null,
      groupName,
      round: fixture?.round ?? null,
      status: match.status,
      scheduledAt: match.scheduledAt?.toISOString() ?? null,
      venueId: match.venueId ?? null,
      courtKind: match.courtKind ?? null,
      courtId: match.courtId ?? null,
      homeTeamId: match.homeTeamId ?? null,
      awayTeamId: match.awayTeamId ?? null,
      homeTeamName: match.homeTeamId
        ? (teamNames.get(match.homeTeamId) ?? null)
        : null,
      awayTeamName: match.awayTeamId
        ? (teamNames.get(match.awayTeamId) ?? null)
        : null,
      homeScore: match.homeScore ?? null,
      awayScore: match.awayScore ?? null,
      version: match.version,
      createdAt: match.createdAt.toISOString(),
      updatedAt: match.updatedAt.toISOString(),
    };
  }

  async schedule(
    tenantId: string,
    matchId: string,
    dto: ScheduleMatchDto,
    actorId?: string,
  ) {
    const match = await this.findMatch(tenantId, matchId);
    assertMatchTransition(match.status as MatchStatus, 'scheduled');
    if (
      dto.expectedVersion != null &&
      dto.expectedVersion !== match.version
    ) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.CONFLICT_RETRY,
      });
    }

    const durationMinutes =
      dto.durationMinutes ?? DEFAULT_MATCH_DURATION_MINUTES;
    const scheduledAt = new Date(dto.scheduledAt);
    const courtKind = normalizeCourtKind(dto.courtKind) ?? dto.courtKind ?? null;
    if (dto.courtId && courtKind) {
      await this.assertNoCourtConflict(
        matchId,
        dto.courtId,
        courtKind,
        scheduledAt,
        durationMinutes,
      );
    }

    match.status = 'scheduled';
    match.scheduledAt = scheduledAt;
    match.venueId = dto.venueId ?? null;
    match.courtKind = courtKind;
    match.courtId = dto.courtId ?? null;
    match.version += 1;
    await this.matches.save(match);

    const { event } = await this.findDivisionContext(tenantId, match.divisionId);
    if (dto.courtId && courtKind && dto.venueId && actorId) {
      const bookingId = await this.matchBooking.syncCourtHold({
        tenantId,
        match,
        scheduledAt,
        durationMinutes,
        courtKind,
        courtId: dto.courtId,
        venueId: dto.venueId,
        actorId,
        tournamentName: event.name,
      });
      if (bookingId) {
        match.metadata = { ...(match.metadata ?? {}), bookingId };
        await this.matches.save(match);
      }
    }
    await this.audit.log({
      tenantId,
      entityType: 'match',
      entityId: matchId,
      actorId,
      afterState: { status: 'scheduled' },
    });
    return match;
  }

  async start(tenantId: string, matchId: string, actorId?: string) {
    const match = await this.findMatch(tenantId, matchId);
    await this.assertDivisionStarted(tenantId, match.divisionId);
    const next: MatchStatus =
      match.status === 'scheduled' ? 'in_progress' : 'in_progress';
    assertMatchTransition(match.status as MatchStatus, next);
    match.status = 'in_progress';
    match.version += 1;
    await this.matches.save(match);
    return match;
  }

  async submitScore(
    tenantId: string,
    matchId: string,
    dto: SubmitScoreDto,
    actorId?: string,
  ) {
    const match = await this.findMatch(tenantId, matchId);
    await this.assertDivisionStarted(tenantId, match.divisionId);
    if (match.status === 'completed' || match.status === 'approved') {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.MATCH_ALREADY_COMPLETED,
      });
    }
    if (dto.homeScore < 0 || dto.awayScore < 0) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.INVALID_SCORE,
      });
    }
    if (
      dto.expectedVersion != null &&
      dto.expectedVersion !== match.version
    ) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.CONFLICT_RETRY,
      });
    }

    if (!match.groupId && dto.homeScore === dto.awayScore) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.INVALID_SCORE,
        message: 'Knockout matches cannot end in a draw',
      });
    }

    match.homeScore = dto.homeScore;
    match.awayScore = dto.awayScore;
    match.status = 'approved';
    match.version += 1;
    await this.matches.save(match);

    await this.applyMatchResult(match, tenantId);

    await this.audit.log({
      tenantId,
      entityType: 'match',
      entityId: matchId,
      actorId,
      afterState: {
        homeScore: dto.homeScore,
        awayScore: dto.awayScore,
        status: 'approved',
      },
    });
    return match;
  }

  async updateStatus(
    tenantId: string,
    matchId: string,
    dto: UpdateMatchStatusDto,
    actorId?: string,
  ) {
    const match = await this.findMatch(tenantId, matchId);
    if (
      dto.expectedVersion != null &&
      dto.expectedVersion !== match.version
    ) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.CONFLICT_RETRY,
      });
    }
    assertMatchTransition(match.status as MatchStatus, dto.status);
    match.status = dto.status;
    match.version += 1;
    await this.matches.save(match);
    await this.audit.log({
      tenantId,
      entityType: 'match',
      entityId: matchId,
      actorId,
      afterState: { status: dto.status },
    });
    return match;
  }

  async approveResult(tenantId: string, matchId: string, actorId?: string) {
    const match = await this.findMatch(tenantId, matchId);
    assertMatchTransition(match.status as MatchStatus, 'approved');
    match.status = 'approved';
    match.version += 1;
    await this.matches.save(match);
    await this.applyMatchResult(match, tenantId);
    return match;
  }

  async walkover(
    tenantId: string,
    matchId: string,
    dto: WalkoverMatchDto,
    actorId?: string,
  ) {
    const match = await this.findMatch(tenantId, matchId);
    await this.assertDivisionStarted(tenantId, match.divisionId);
    assertMatchTransition(match.status as MatchStatus, 'walkover');
    const isHome = match.homeTeamId === dto.winnerTeamId;
    const isAway = match.awayTeamId === dto.winnerTeamId;
    if (!isHome && !isAway) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.INVALID_SCORE,
        message: 'Winner must be a participant',
      });
    }
    match.homeScore = isHome ? 3 : 0;
    match.awayScore = isAway ? 3 : 0;
    match.status = 'walkover';
    match.metadata = { ...(match.metadata ?? {}), walkoverReason: dto.reason };
    match.version += 1;
    await this.matches.save(match);
    await this.applyMatchResult(match, tenantId);
    return match;
  }

  private async assertDivisionStarted(
    tenantId: string,
    divisionId: string,
  ): Promise<void> {
    const { division } = await this.findDivisionContext(tenantId, divisionId);
    if (division.status !== 'in_progress') {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.TOURNAMENT_INVALID_STATE,
        message: 'Tournament has not started yet',
      });
    }
  }

  private async applyMatchResult(
    match: TournamentMatch,
    tenantId: string,
  ): Promise<void> {
    if (match.groupId) {
      await this.recomputeGroupStandings(match.groupId, tenantId);
    } else {
      await this.knockoutBracket.tryCompleteKnockoutStage(
        match.stageId,
        match.divisionId,
      );
    }
    await this.tryCompleteGroupStage(match.stageId, match.divisionId);
  }

  private async tryCompleteGroupStage(
    stageId: string,
    divisionId: string,
  ): Promise<void> {
    const stage = await this.stages.findOne({ where: { id: stageId } });
    if (!stage || stage.stageType !== 'group' || stage.status === 'completed') {
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
    if (open === 0) {
      stage.status = 'completed';
      await this.stages.save(stage);
    }
  }

  private async recomputeGroupStandings(groupId: string, tenantId: string) {
    const group = await this.groups.findOne({ where: { id: groupId } });
    if (!group) return;

    const members = await this.standings.find({ where: { groupId } });
    const teamIds = members.map((m) => m.teamId);

    const completed = await this.matches.find({
      where: {
        groupId,
        status: In(['approved', 'walkover']),
        deletedAt: IsNull(),
      },
    });

    const division = await this.divisions.findOne({
      where: { id: completed[0]?.divisionId },
    });
    let rules = DEFAULT_STANDINGS_RULES;
    if (division?.currentConfigVersionId) {
      const cfg = await this.configs.findOne({
        where: { id: division.currentConfigVersionId },
      });
      if (cfg?.standingsRules) rules = cfg.standingsRules;
    }

    const results: MatchResultInput[] = completed
      .filter((m) => m.homeTeamId && m.awayTeamId)
      .map((m) => ({
        homeTeamId: m.homeTeamId!,
        awayTeamId: m.awayTeamId!,
        homeScore: m.homeScore ?? 0,
        awayScore: m.awayScore ?? 0,
      }));

    const computed = computeStandings(teamIds, results, rules);
    for (const row of computed) {
      await this.standings.update(
        { groupId, teamId: row.teamId },
        {
          played: row.played,
          won: row.won,
          drawn: row.drawn,
          lost: row.lost,
          goalsFor: row.goalsFor,
          goalsAgainst: row.goalsAgainst,
          points: row.points,
          rank: row.rank ?? null,
        },
      );
    }
  }

  private async assertNoCourtConflict(
    matchId: string,
    courtId: string,
    courtKind: string,
    start: Date,
    durationMinutes: number,
  ): Promise<void> {
    const end = new Date(start.getTime() + durationMinutes * 60_000);

    const bookingOverlap = await this.bookingItems
      .createQueryBuilder('i')
      .innerJoin('i.booking', 'b')
      .where('i.courtKind = :courtKind', { courtKind })
      .andWhere('i.courtId = :courtId', { courtId })
      .andWhere("i.itemStatus <> 'cancelled'")
      .andWhere("b.bookingStatus NOT IN ('cancelled', 'no_show', 'completed')")
      .andWhere('i.startDatetime < :end', { end: end.toISOString() })
      .andWhere('i.endDatetime > :start', { start: start.toISOString() })
      .getCount();

    if (bookingOverlap > 0) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.COURT_CONFLICT,
        message: 'Court is already booked for this time',
      });
    }

    const otherMatches = await this.matches.find({
      where: {
        courtId,
        courtKind,
        id: Not(matchId),
        deletedAt: IsNull(),
        status: Not('cancelled' as const),
      },
    });

    const startMs = start.getTime();
    const endMs = end.getTime();
    for (const other of otherMatches) {
      if (!other.scheduledAt) continue;
      const otherStart = other.scheduledAt.getTime();
      const otherEnd = otherStart + durationMinutes * 60_000;
      if (otherStart < endMs && otherEnd > startMs) {
        throw new ConflictException({
          code: TOURNAMENT_ERROR_CODES.COURT_CONFLICT,
          message: 'Another tournament match is scheduled on this court',
        });
      }
    }
  }

  private async findDivisionContext(tenantId: string, divisionId: string) {
    const division = await this.divisions.findOne({
      where: { id: divisionId, deletedAt: IsNull() },
    });
    if (!division) throw new NotFoundException('Match not found');
    const event = await this.tournaments.findOne({
      where: { id: division.tournamentId, tenantId, deletedAt: IsNull() },
    });
    if (!event) throw new NotFoundException('Match not found');
    return { division, event };
  }

  private async findMatch(tenantId: string, matchId: string) {
    const match = await this.matches.findOne({
      where: { id: matchId, deletedAt: IsNull() },
    });
    if (!match) throw new NotFoundException('Match not found');
    await this.findDivisionContext(tenantId, match.divisionId);
    return match;
  }
}
