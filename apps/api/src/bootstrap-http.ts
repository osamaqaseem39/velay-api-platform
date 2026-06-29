import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { setupSwaggerIfEnabled } from './swagger.setup';
import { DatabaseQueryExceptionFilter } from './common/filters/database-query-exception.filter';

/** Merged with `CORS_ORIGINS` / `CORS_ORIGIN` when set (see `applyHttpGlobals`). */
const DEFAULT_CORS_ORIGINS: readonly string[] = [
  'https://www.vellay.pro',
  'https://www.velay.app',
  'https://www.velay.pro',
  'https://www.vellay.app',
  'https://www.vellay.xyz',
  'https://vellay.pro',
  'https://velay.app',
  'https://velay.pro',
  'https://vellay.app',
  'https://vellay.xyz',
  'http://localhost:3000',
  'https://booking-saas-kappa.vercel.app'
];

export function applyHttpGlobals(app: NestExpressApplication): void {
  const originsEnv = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '';
  const fromEnv = originsEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const hasEnvOrigins = fromEnv.length > 0;
  const allowedOrigins = hasEnvOrigins
    ? [...new Set([...DEFAULT_CORS_ORIGINS, ...fromEnv])]
    : [];
  const allowVercelPreviews =
    (process.env.CORS_ALLOW_VERCEL_PREVIEWS ?? 'true').toLowerCase() !== 'false';

  function isAllowedOrigin(origin: string): boolean {
    if (!origin) return false;
    if (allowedOrigins.length === 0) return true;
    if (allowedOrigins.includes(origin)) return true;
    if (/^https?:\/\/localhost(?::\d+)?$/i.test(origin)) return true;
    if (allowVercelPreviews && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
      return true;
    }
    return false;
  }

  // Explicit CORS middleware to ensure preflight `OPTIONS` requests
  // never hit a 404/route-miss without `Access-Control-Allow-Origin`.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin as string | undefined;

    let corsAllowed = false;
    if (origin) {
      corsAllowed = isAllowedOrigin(origin);
      if (corsAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    }

    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    );

    const requestHeaders = req.header('Access-Control-Request-Headers');
    res.setHeader(
      'Access-Control-Allow-Headers',
      requestHeaders ??
        'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-User-Id, X-Tenant-Id',
    );

    if (req.method === 'OPTIONS') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      if (corsAllowed) {
        res.setHeader('Access-Control-Max-Age', '0');
      }
      res.status(204).send();
      return;
    }

    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(
    new ApiExceptionFilter(),
    new DatabaseQueryExceptionFilter(),
  );
}

export async function createNestExpressApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  applyHttpGlobals(app);
  return app;
}

export async function bootstrapHttpApp(): Promise<void> {
  const app = await createNestExpressApp();
  await app.init();
  setupSwaggerIfEnabled(app);
  await app.listen(process.env.PORT ?? 3000);
}

export { setupSwaggerIfEnabled } from './swagger.setup';
