import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import {
  capJsonForAudit,
  normalizeHttpPath,
  redactSensitivePayload,
} from './audit.utils';

type AuditedRequest = Request & {
  userId?: string;
  tenantContext?: { tenantId?: string };
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<AuditedRequest>();
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      return next.handle();
    }

    const pathOnly = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
    if (
      pathOnly === '/health' ||
      pathOnly === '/metrics' ||
      pathOnly === '/audit/client-events' ||
      pathOnly === '/audit/client-events/batch'
    ) {
      return next.handle();
    }

    const started = Date.now();
    let errorMessage: string | null = null;

    return next.handle().pipe(
      tap({
        error: (err: unknown) => {
          const msg =
            err instanceof Error
              ? err.message
              : typeof err === 'string'
                ? err
                : JSON.stringify(err);
          errorMessage = (msg ?? 'error').slice(0, 4000);
        },
      }),
      finalize(() => {
        const res = context.switchToHttp().getResponse<Response>();
        const durationMs = Math.min(86_400_000, Date.now() - started);

        const tenantHeader = req.header('x-tenant-id')?.trim();
        const tenantId =
          req.tenantContext?.tenantId?.trim() || tenantHeader || null;

        const userId = req.userId?.trim() || null;
        const ip =
          (req.ip || req.socket?.remoteAddress || '').toString().slice(0, 64) ||
          null;
        const userAgent = req.get('user-agent')?.slice(0, 4000) ?? null;

        let requestBody: Record<string, unknown> | null = null;
        if (
          method !== 'GET' &&
          method !== 'HEAD' &&
          req.body &&
          typeof req.body === 'object' &&
          !Buffer.isBuffer(req.body)
        ) {
          requestBody = capJsonForAudit(
            redactSensitivePayload(req.body),
          ) as Record<string, unknown> | null;
        }

        let query: Record<string, unknown> | null = null;
        if (req.query && typeof req.query === 'object') {
          const keys = Object.keys(req.query as object);
          if (keys.length > 0) {
            query = capJsonForAudit(
              redactSensitivePayload(req.query),
            ) as Record<string, unknown> | null;
          }
        }

        const fullPath = (req.originalUrl ?? req.url ?? pathOnly).slice(0, 8000);

        void this.auditService.record({
          method,
          path: fullPath,
          normalizedPath: normalizeHttpPath(pathOnly),
          statusCode: res.statusCode ?? 0,
          durationMs,
          tenantId,
          userId,
          ip,
          userAgent,
          requestBody,
          query,
          errorMessage,
        });
      }),
    );
  }
}
