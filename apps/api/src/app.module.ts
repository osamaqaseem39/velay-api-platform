import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { shouldRunStartupMigrations } from './database/migration-startup.util';
import { typeOrmOptions } from './database/typeorm.config';
import { HealthModule } from './health/health.module';
import { ArenaModule } from './modules/arena/arena.module';
import { BillingModule } from './modules/billing/billing.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { FacilityCatalogModule } from './modules/facility-catalog/facility-catalog.module';
import { AuthModule } from './modules/auth/auth.module';
import { IamModule } from './modules/iam/iam.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SaasSubscriptionsModule } from './modules/saas-subscriptions/saas-subscriptions.module';
import { TournamentsModule } from './modules/tournaments/tournaments.module';

import { TenancyModule } from './tenancy/tenancy.module';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisModule } from '../../../libs/database/src/redis/redis.module';
import { AuditModule } from './modules/audit/audit.module';
import { HttpMetricsModule } from './observability/http-metrics.module';

function createTypeOrmConfig(): TypeOrmModuleOptions {
  const poolMax = resolvePoolMax();
  const poolIdleTimeoutMs = toPositiveInt(process.env.DB_POOL_IDLE_MS, 10000);
  const poolConnectTimeoutMs = toPositiveInt(
    process.env.DB_POOL_CONNECT_MS,
    10000,
  );
  const url = pickDatabaseUrl();
  if (url) {
    const parsed = new URL(url);
    const sslMode = parsed.searchParams.get('sslmode');
    const cfg: TypeOrmModuleOptions = {
      type: 'postgres',
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      username: parsed.username,
      password: parsed.password,
      database: parsed.pathname.replace(/^\//, ''),
      autoLoadEntities: true,
      synchronize: (process.env.DB_SYNC ?? 'false') === 'true',
      ssl: sslMode === 'require' ? { rejectUnauthorized: false } : false,
      extra: {
        max: poolMax,
        min: 0,
        idleTimeoutMillis: poolIdleTimeoutMs,
        connectionTimeoutMillis: poolConnectTimeoutMs,
      },
      migrations: typeOrmOptions.migrations,
      migrationsRun: shouldRunStartupMigrations(),
    };
    if (!(globalThis as any).__dbEnvLogged) {
      (globalThis as any).__dbEnvLogged = true;

      console.log(
        '[DB] host=',
        cfg.host,
        'port=',
        cfg.port,
        'db=',
        cfg.database,
        'poolMax=',
        poolMax,
      );
    }
    return cfg;
  }

  const isServerless =
    process.env.VERCEL === '1' ||
    process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
  if (isServerless) {
    throw new Error(
      '[DB] Missing POSTGRES_URL/DATABASE_URL in serverless environment. Refusing localhost fallback; configure a managed Postgres URL (typically with sslmode=require).',
    );
  }

  // Fallback: explicit DB_* vars
  const cfg: TypeOrmModuleOptions = {
    type: 'postgres',
    host: process.env.DB_HOST ?? process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username:
      process.env.DB_USERNAME ?? process.env.POSTGRES_USER ?? 'postgres',
    password:
      process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? 'postgres',
    database:
      process.env.DB_NAME ?? process.env.POSTGRES_DATABASE ?? 'backend_saas',
    autoLoadEntities: true,
    synchronize: (process.env.DB_SYNC ?? 'false') === 'true',
    ssl:
      process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : sslModeFromEnv(),
    extra: {
      max: poolMax,
      min: 0,
      idleTimeoutMillis: poolIdleTimeoutMs,
      connectionTimeoutMillis: poolConnectTimeoutMs,
    },
    migrations: typeOrmOptions.migrations,
    migrationsRun: shouldRunStartupMigrations(),
  };
  if (!(globalThis as any).__dbEnvLogged) {
    (globalThis as any).__dbEnvLogged = true;

    console.log('[DB] host=', cfg.host, 'port=', cfg.port, 'db=', cfg.database);
    console.log(
      '[DB] poolMax=',
      poolMax,
      'idleMs=',
      poolIdleTimeoutMs,
      'connectMs=',
      poolConnectTimeoutMs,
    );
  }
  return cfg;
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

function pickDatabaseUrl(): string | undefined {
  // Runtime should prefer pooled URL in serverless environments.
  return (
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL_NON_POOLING
  );
}

function resolvePoolMax(): number {
  const configured = toPositiveInt(process.env.DB_POOL_MAX, 3);
  const isServerless =
    process.env.VERCEL === '1' ||
    process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
  // Keep each warm instance tiny; concurrency scales by instances, not per-instance pool.
  const hardCap = isServerless ? 3 : 10;
  return Math.max(1, Math.min(configured, hardCap));
}

function sslModeFromEnv() {
  // In Supabase, SSL is typically required when using pooler URLs.
  // If DB_SSL is not set, default to enabling SSL when the pooler URL is used.
  const url = pickDatabaseUrl();
  if (!url) return false;
  const parsed = new URL(url);
  const sslMode = parsed.searchParams.get('sslmode');
  return sslMode === 'require' ? { rejectUnauthorized: false } : false;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    HttpMetricsModule,
    AuditModule,
    ScheduleModule.forRoot(),
    JwtModule.register({
      secret:
        process.env.JWT_SECRET ??
        process.env.SUPABASE_JWT_SECRET ??
        process.env.SUPABASE_SECRET_KEY ??
        'dev-jwt-secret',
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as any,
      },
    }),
    TypeOrmModule.forRoot(createTypeOrmConfig()),
    TenancyModule,
    HealthModule,
    ArenaModule,
    AuthModule,
    IamModule,
    FacilityCatalogModule,
    BookingsModule,
    BillingModule,
    BusinessesModule,
    PaymentsModule,
    SaasSubscriptionsModule,
    TournamentsModule,
  ],
})
export class AppModule {}
