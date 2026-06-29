import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Tournament } from '../entities/tournament.entity';
import { TournamentDivision } from '../entities/tournament-division.entity';
import { TournamentRegistration } from '../entities/tournament-registration.entity';
import { Team } from '../entities/team.entity';
import { TeamMember } from '../entities/team-member.entity';
import { RegisterTeamDto } from '../dto/register-team.dto';
import {
  ACTIVE_REGISTRATION_STATUSES,
  TOURNAMENT_ERROR_CODES,
} from '../types/tournament.types';
import { TournamentAuditService } from './tournament-audit.service';

@Injectable()
export class RegistrationsService {
  constructor(
    @InjectRepository(Tournament)
    private readonly tournaments: Repository<Tournament>,
    @InjectRepository(TournamentDivision)
    private readonly divisions: Repository<TournamentDivision>,
    @InjectRepository(TournamentRegistration)
    private readonly registrations: Repository<TournamentRegistration>,
    @InjectRepository(Team)
    private readonly teams: Repository<Team>,
    @InjectRepository(TeamMember)
    private readonly members: Repository<TeamMember>,
    private readonly audit: TournamentAuditService,
  ) {}

  async listForTournament(divisionId: string) {
    const rows = await this.registrations.find({
      where: { divisionId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    if (rows.length === 0) return [];

    const teams = await this.teams.find({
      where: { id: In(rows.map((r) => r.teamId)) },
    });
    const teamNames = new Map(teams.map((t) => [t.id, t.name]));

    return rows.map((r) => ({
      id: r.id,
      tournamentId: r.divisionId,
      teamId: r.teamId,
      teamName: teamNames.get(r.teamId) ?? null,
      status: r.status,
      paymentStatus: r.paymentStatus,
      waitlistPosition: r.waitlistPosition ?? null,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      rejectedReason: r.rejectedReason ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async register(
    tenantId: string,
    divisionId: string,
    dto: RegisterTeamDto,
    actorId?: string,
    idempotencyKey?: string,
  ) {
    const { division, event } = await this.findDivisionContext(
      tenantId,
      divisionId,
    );

    if (division.status !== 'registration_open') {
      throw new ForbiddenException({
        code: TOURNAMENT_ERROR_CODES.REGISTRATION_CLOSED,
        message: 'Registration is not open',
      });
    }

    if (idempotencyKey) {
      const existing = await this.registrations.findOne({
        where: { idempotencyKey },
      });
      if (existing) {
        const team = await this.teams.findOne({
          where: { id: existing.teamId },
        });
        if (team) {
          return this.formatPublicRegistration(existing, team, division, event);
        }
      }
    }

    const activeCount = await this.countActiveRegistrations(divisionId);
    if (activeCount >= division.maxTeams) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.REGISTRATION_FULL,
        message: 'Tournament is full',
      });
    }

    let team: Team;
    if (dto.teamId) {
      const found = await this.teams.findOne({
        where: { id: dto.teamId, tenantId, deletedAt: IsNull() },
      });
      if (!found) throw new NotFoundException('Team not found');
      team = found;
    } else {
      team = await this.teams.save({
        tenantId,
        name: dto.teamName,
      });
      if (dto.members?.length) {
        for (const m of dto.members) {
          await this.members.save({
            teamId: team.id,
            userId: m.userId ?? null,
            displayName: m.displayName ?? null,
            role: m.role,
            jerseyNumber: m.jerseyNumber ?? null,
          });
        }
      }
    }

    const dup = await this.registrations.findOne({
      where: { divisionId, teamId: team.id, deletedAt: IsNull() },
    });
    if (dup && !['cancelled', 'rejected', 'withdrawn'].includes(dup.status)) {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.TEAM_ALREADY_REGISTERED,
        message: 'Team already registered',
      });
    }

    const reg = await this.registrations.save({
      divisionId,
      teamId: team.id,
      status: 'pending',
      waitlistPosition: null,
      idempotencyKey: idempotencyKey ?? null,
      paymentStatus:
        division.entryFeeAmount && Number(division.entryFeeAmount) > 0
          ? 'pending'
          : 'paid',
    });

    await this.audit.log({
      tenantId,
      entityType: 'registration',
      entityId: reg.id,
      actorId,
      afterState: { status: reg.status, teamId: team.id },
    });

    return this.formatPublicRegistration(reg, team, division, event);
  }

  async approve(
    tenantId: string,
    registrationId: string,
    actorId?: string,
  ) {
    const reg = await this.findRegistration(tenantId, registrationId);
    const division = await this.divisions.findOne({
      where: { id: reg.divisionId, deletedAt: IsNull() },
    });
    if (!division) throw new NotFoundException('Tournament not found');

    const entryFee = Number(division.entryFeeAmount ?? 0);
    if (entryFee > 0 && reg.paymentStatus !== 'paid') {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.PAYMENT_NOT_CONFIRMED,
        message: 'Entry fee must be paid before approval',
      });
    }

    if (reg.status !== 'approved') {
      const approvedCount = await this.registrations.count({
        where: {
          divisionId: reg.divisionId,
          status: 'approved' as const,
          deletedAt: IsNull(),
        },
      });
      if (approvedCount >= division.maxTeams) {
        throw new ConflictException({
          code: TOURNAMENT_ERROR_CODES.REGISTRATION_FULL,
          message: 'Tournament is full',
        });
      }
    }

    reg.status = 'approved';
    reg.approvedAt = new Date();
    reg.version += 1;
    await this.registrations.save(reg);
    await this.audit.log({
      tenantId,
      entityType: 'registration',
      entityId: reg.id,
      actorId,
      afterState: { status: 'approved' },
    });
    return reg;
  }

  async markPaid(
    tenantId: string,
    registrationId: string,
    actorId?: string,
  ) {
    const reg = await this.findRegistration(tenantId, registrationId);
    if (reg.paymentStatus === 'paid') {
      throw new ConflictException({
        code: TOURNAMENT_ERROR_CODES.PAYMENT_ALREADY_PROCESSED,
        message: 'Payment already recorded',
      });
    }
    reg.paymentStatus = 'paid';
    reg.version += 1;
    await this.registrations.save(reg);
    await this.audit.log({
      tenantId,
      entityType: 'registration',
      entityId: reg.id,
      actorId,
      afterState: { paymentStatus: 'paid' },
    });
    return reg;
  }

  async reject(
    tenantId: string,
    registrationId: string,
    reason?: string,
    actorId?: string,
  ) {
    const reg = await this.findRegistration(tenantId, registrationId);
    reg.status = 'rejected';
    reg.rejectedReason = reason ?? null;
    reg.version += 1;
    await this.registrations.save(reg);
    await this.audit.log({
      tenantId,
      entityType: 'registration',
      entityId: reg.id,
      actorId,
      afterState: { status: 'rejected', reason },
    });
    return reg;
  }

  async listForUser(userId: string) {
    const memberships = await this.members.find({ where: { userId } });
    if (memberships.length === 0) return { items: [] };

    const teamIds = memberships.map((m) => m.teamId);
    const rows = await this.registrations.find({
      where: { teamId: In(teamIds), deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (rows.length === 0) return { items: [] };

    const divisions = await this.divisions.find({
      where: { id: In(rows.map((r) => r.divisionId)) },
    });
    const dMap = new Map(divisions.map((d) => [d.id, d]));
    const events = await this.tournaments.find({
      where: { id: In(divisions.map((d) => d.tournamentId)) },
    });
    const eMap = new Map(events.map((e) => [e.id, e]));
    const teams = await this.teams.find({
      where: { id: In(rows.map((r) => r.teamId)) },
    });
    const teamNames = new Map(teams.map((t) => [t.id, t.name]));

    return {
      items: rows.map((r) => {
        const d = dMap.get(r.divisionId);
        const e = d ? eMap.get(d.tournamentId) : undefined;
        return {
          id: r.id,
          tournamentId: r.divisionId,
          tournamentName: e?.name ?? null,
          teamId: r.teamId,
          teamName: teamNames.get(r.teamId) ?? null,
          status: r.status,
          paymentStatus: r.paymentStatus,
          sport: d?.sport ?? null,
          startsAt: e?.startsAt.toISOString() ?? null,
          entryFeeAmount:
            d?.entryFeeAmount != null ? Number(d.entryFeeAmount) : null,
          createdAt: r.createdAt.toISOString(),
        };
      }),
    };
  }

  formatPublicRegistration(
    reg: TournamentRegistration,
    team: Team,
    division: TournamentDivision,
    _event: Tournament,
  ) {
    const entryFee = Number(division.entryFeeAmount ?? 0);
    const paymentExpiresAt = new Date(
      reg.createdAt.getTime() + 15 * 60_000,
    ).toISOString();
    return {
      registration: {
        id: reg.id,
        tournamentId: reg.divisionId,
        teamId: reg.teamId,
        status: reg.status,
        paymentStatus: reg.paymentStatus,
        waitlistPosition: reg.waitlistPosition ?? null,
        entryFeeAmount: entryFee > 0 ? entryFee : null,
        entryFeeCurrency: division.entryFeeCurrency,
        paymentExpiresAt: entryFee > 0 ? paymentExpiresAt : null,
        createdAt: reg.createdAt.toISOString(),
      },
      team: { id: team.id, name: team.name },
    };
  }

  private countActiveRegistrations(divisionId: string) {
    return this.registrations.count({
      where: {
        divisionId,
        status: In([...ACTIVE_REGISTRATION_STATUSES]),
        deletedAt: IsNull(),
      },
    });
  }

  private async findDivisionContext(tenantId: string, divisionId: string) {
    const division = await this.divisions.findOne({
      where: { id: divisionId, deletedAt: IsNull() },
    });
    if (!division) throw new NotFoundException('Tournament not found');
    const event = await this.tournaments.findOne({
      where: { id: division.tournamentId, tenantId, deletedAt: IsNull() },
    });
    if (!event) throw new NotFoundException('Tournament not found');
    return { division, event };
  }

  private async findRegistration(tenantId: string, id: string) {
    const reg = await this.registrations.findOne({ where: { id } });
    if (!reg) throw new NotFoundException('Registration not found');
    await this.findDivisionContext(tenantId, reg.divisionId);
    return reg;
  }
}
