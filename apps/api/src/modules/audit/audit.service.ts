import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEvent } from './audit-event.entity';

export type AuditRecordInput = Pick<
  AuditEvent,
  | 'method'
  | 'path'
  | 'normalizedPath'
  | 'statusCode'
  | 'durationMs'
  | 'tenantId'
  | 'userId'
  | 'ip'
  | 'userAgent'
  | 'requestBody'
  | 'query'
  | 'errorMessage'
>;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditEvent)
    private readonly auditRepository: Repository<AuditEvent>,
  ) {}

  /** Persists one row; failures are logged and never thrown to callers. */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      const row = this.auditRepository.create(input);
      await this.auditRepository.save(row);
    } catch (err) {
      this.logger.warn(
        `audit_events insert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Persists many rows best-effort; failures are logged and never thrown. */
  async recordMany(inputs: AuditRecordInput[]): Promise<void> {
    if (!Array.isArray(inputs) || inputs.length === 0) return;
    try {
      const rows = inputs.map((input) => this.auditRepository.create(input));
      await this.auditRepository.save(rows);
    } catch (err) {
      this.logger.warn(
        `audit_events batch insert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listClientSessions(opts: {
    from?: Date;
    to?: Date;
    userId?: string;
    limit?: number;
  }): Promise<
    Array<{
      sessionId: string;
      startedAt: string;
      lastEventAt: string;
      eventCount: number;
      userId: string | null;
      tenantId: string | null;
    }>
  > {
    const qb = this.auditRepository
      .createQueryBuilder('a')
      .select(`a.requestBody->'metadata'->>'sessionId'`, 'sessionId')
      .addSelect(`MIN(a.occurredAt)`, 'startedAt')
      .addSelect(`MAX(a.occurredAt)`, 'lastEventAt')
      .addSelect(`COUNT(*)::int`, 'eventCount')
      .addSelect(`MAX(a.userId)`, 'userId')
      .addSelect(`MAX(a.tenantId)`, 'tenantId')
      .where(`a.method = :method`, { method: 'CLIENT' })
      .andWhere(`a.requestBody IS NOT NULL`)
      .andWhere(`a.requestBody->'metadata'->>'sessionId' IS NOT NULL`)
      .andWhere(`a.requestBody->'metadata'->>'sessionId' <> ''`);

    if (opts.userId) {
      qb.andWhere(`a.userId = :userId`, { userId: opts.userId });
    }
    if (opts.from) {
      qb.andWhere(`a.occurredAt >= :from`, { from: opts.from.toISOString() });
    }
    if (opts.to) {
      qb.andWhere(`a.occurredAt <= :to`, { to: opts.to.toISOString() });
    }

    const rows = await qb
      .groupBy(`a.requestBody->'metadata'->>'sessionId'`)
      .orderBy(`MAX(a.occurredAt)`, 'DESC')
      .limit(Math.max(1, Math.min(500, opts.limit ?? 100)))
      .getRawMany<{
        sessionId: string;
        startedAt: string;
        lastEventAt: string;
        eventCount: string | number;
        userId: string | null;
        tenantId: string | null;
      }>();

    return rows.map((r) => ({
      sessionId: r.sessionId,
      startedAt: r.startedAt,
      lastEventAt: r.lastEventAt,
      eventCount: Number(r.eventCount) || 0,
      userId: r.userId ?? null,
      tenantId: r.tenantId ?? null,
    }));
  }

  async listClientSessionEvents(sessionId: string): Promise<
    Array<{
      id: string;
      occurredAt: string;
      userId: string | null;
      tenantId: string | null;
      eventName: string | null;
      page: string | null;
      targetType: string | null;
      targetId: string | null;
      metadata: Record<string, unknown>;
    }>
  > {
    const rows = await this.auditRepository
      .createQueryBuilder('a')
      .select('a.id', 'id')
      .addSelect('a.occurredAt', 'occurredAt')
      .addSelect('a.userId', 'userId')
      .addSelect('a.tenantId', 'tenantId')
      .addSelect(`a.requestBody->>'eventName'`, 'eventName')
      .addSelect(`a.requestBody->>'page'`, 'page')
      .addSelect(`a.requestBody->>'targetType'`, 'targetType')
      .addSelect(`a.requestBody->>'targetId'`, 'targetId')
      .addSelect(`a.requestBody->'metadata'`, 'metadata')
      .where(`a.method = :method`, { method: 'CLIENT' })
      .andWhere(`a.requestBody->'metadata'->>'sessionId' = :sessionId`, {
        sessionId,
      })
      .orderBy('a.occurredAt', 'ASC')
      .limit(5000)
      .getRawMany<{
        id: string;
        occurredAt: string;
        userId: string | null;
        tenantId: string | null;
        eventName: string | null;
        page: string | null;
        targetType: string | null;
        targetId: string | null;
        metadata: Record<string, unknown> | null;
      }>();

    return rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      userId: r.userId ?? null,
      tenantId: r.tenantId ?? null,
      eventName: r.eventName ?? null,
      page: r.page ?? null,
      targetType: r.targetType ?? null,
      targetId: r.targetId ?? null,
      metadata: r.metadata ?? {},
    }));
  }
}
