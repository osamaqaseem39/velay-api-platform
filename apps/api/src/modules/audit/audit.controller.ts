import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from './audit.service';
import { capJsonForAudit, redactSensitivePayload } from './audit.utils';

type AuditedRequest = Request & {
  userId?: string;
  tenantContext?: { tenantId?: string };
};

type ClientEventBody = {
  eventName?: string;
  page?: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

type ClientSessionSummary = {
  sessionId: string;
  startedAt: string;
  lastEventAt: string;
  eventCount: number;
  userId: string | null;
  tenantId: string | null;
};

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  private buildAuditInput(req: AuditedRequest, body: ClientEventBody) {
    const eventName = (body.eventName ?? '').trim().slice(0, 128) || 'unknown';
    const page = (body.page ?? '').trim().slice(0, 400) || null;
    const targetType = (body.targetType ?? '').trim().slice(0, 64) || null;
    const targetId = (body.targetId ?? '').trim().slice(0, 128) || null;
    const tenantHeader = req.header('x-tenant-id')?.trim();
    const tenantId = req.tenantContext?.tenantId?.trim() || tenantHeader || null;
    const userId = req.userId?.trim() || null;
    const ip =
      (req.ip || req.socket?.remoteAddress || '').toString().slice(0, 64) || null;
    const userAgent = req.get('user-agent')?.slice(0, 4000) ?? null;
    return {
      method: 'CLIENT' as const,
      path: `/client/${eventName}`,
      normalizedPath: '/client/:eventName',
      statusCode: 200,
      durationMs: 0,
      tenantId,
      userId,
      ip,
      userAgent,
      query: null,
      errorMessage: null,
      requestBody: capJsonForAudit(
        redactSensitivePayload({
          eventName,
          page,
          targetType,
          targetId,
          metadata: body.metadata ?? {},
        }),
      ) as Record<string, unknown>,
    };
  }

  @Post('client-events')
  async captureClientEvent(
    @Req() req: AuditedRequest,
    @Body() body: ClientEventBody,
  ): Promise<{ ok: true }> {
    await this.auditService.record(this.buildAuditInput(req, body));

    return { ok: true };
  }

  @Post('client-events/batch')
  async captureClientEventsBatch(
    @Req() req: AuditedRequest,
    @Body() body: { events?: ClientEventBody[] },
  ): Promise<{ ok: true; accepted: number }> {
    const events = Array.isArray(body?.events) ? body.events.slice(0, 200) : [];
    if (!events.length) return { ok: true, accepted: 0 };
    await this.auditService.recordMany(
      events.map((ev) => this.buildAuditInput(req, ev)),
    );
    return { ok: true, accepted: events.length };
  }

  @Get('sessions')
  async getClientSessions(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<{ sessions: ClientSessionSummary[] }> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const limit = Number(limitRaw || 100);
    const sessions = await this.auditService.listClientSessions({
      ...(fromDate && !Number.isNaN(fromDate.getTime()) ? { from: fromDate } : {}),
      ...(toDate && !Number.isNaN(toDate.getTime()) ? { to: toDate } : {}),
      ...(userId?.trim() ? { userId: userId.trim() } : {}),
      ...(Number.isFinite(limit) ? { limit } : {}),
    });
    return { sessions };
  }

  @Get('sessions/:sessionId/events')
  async getClientSessionEvents(
    @Param('sessionId') sessionId: string,
  ): Promise<{ events: Awaited<ReturnType<AuditService['listClientSessionEvents']>> }> {
    const normalized = (sessionId ?? '').trim().slice(0, 128);
    if (!normalized) return { events: [] };
    return {
      events: await this.auditService.listClientSessionEvents(normalized),
    };
  }
}
