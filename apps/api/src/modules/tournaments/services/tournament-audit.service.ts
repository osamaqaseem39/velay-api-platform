import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TournamentAuditLog } from '../entities/tournament-audit-log.entity';

@Injectable()
export class TournamentAuditService {
  constructor(
    @InjectRepository(TournamentAuditLog)
    private readonly logs: Repository<TournamentAuditLog>,
  ) {}

  async log(input: {
    tenantId: string;
    entityType: string;
    entityId: string;
    actorId?: string;
    actorIp?: string;
    reason?: string;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
  }): Promise<void> {
    await this.logs.save({
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId ?? null,
      actorIp: input.actorIp ?? null,
      reason: input.reason ?? null,
      beforeState: input.beforeState ?? null,
      afterState: input.afterState ?? null,
    });
  }
}
