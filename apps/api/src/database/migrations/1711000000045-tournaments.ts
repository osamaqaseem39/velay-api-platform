import { MigrationInterface, QueryRunner } from 'typeorm';

export class Tournaments1711000000045 implements MigrationInterface {
  name = 'Tournaments1711000000045';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "teams" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "name" varchar(200) NOT NULL,
        "deletedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_teams_tenant" ON "teams" ("tenantId") WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "team_members" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "teamId" uuid NOT NULL,
        "userId" uuid,
        "displayName" varchar(200),
        "role" varchar(32) NOT NULL DEFAULT 'player',
        "jerseyNumber" int,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_team_members_team" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_team_members_team_user"
      ON "team_members" ("teamId", "userId") WHERE "userId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournaments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "name" varchar(300) NOT NULL,
        "sport" varchar(64) NOT NULL,
        "venueIds" jsonb NOT NULL DEFAULT '[]',
        "registrationOpensAt" TIMESTAMPTZ,
        "registrationClosesAt" TIMESTAMPTZ,
        "startsAt" TIMESTAMPTZ NOT NULL,
        "endsAt" TIMESTAMPTZ,
        "maxTeams" int NOT NULL,
        "entryFeeAmount" decimal(12,2),
        "entryFeeCurrency" varchar(8) DEFAULT 'PKR',
        "prizePool" jsonb,
        "rules" text,
        "structureType" varchar(48) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'draft',
        "currentConfigVersionId" uuid,
        "version" int NOT NULL DEFAULT 1,
        "deletedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tournaments_tenant_status"
      ON "tournaments" ("tenantId", "status") WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournament_config_versions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tournamentId" uuid NOT NULL,
        "version" int NOT NULL,
        "structureBlueprint" jsonb NOT NULL,
        "standingsRules" jsonb NOT NULL,
        "seedingMode" varchar(24) NOT NULL DEFAULT 'ranking',
        "advancementRules" jsonb NOT NULL DEFAULT '[]',
        "lockedAt" TIMESTAMPTZ,
        "lockedByUserId" uuid,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_tcv_tournament" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_tcv_tournament_version" UNIQUE ("tournamentId", "version")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournament_stages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tournamentId" uuid NOT NULL,
        "configVersionId" uuid NOT NULL,
        "order" int NOT NULL,
        "name" varchar(120) NOT NULL,
        "stageType" varchar(32) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "version" int NOT NULL DEFAULT 1,
        "deletedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_stage_tournament" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_stage_config" FOREIGN KEY ("configVersionId") REFERENCES "tournament_config_versions"("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_stage_tournament_order" UNIQUE ("tournamentId", "order")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stage_advancement_rules" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "stageId" uuid NOT NULL,
        "ruleType" varchar(48) NOT NULL,
        "ruleDefinition" jsonb NOT NULL,
        "targetStageOrder" int,
        CONSTRAINT "fk_sar_stage" FOREIGN KEY ("stageId") REFERENCES "tournament_stages"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournament_registrations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tournamentId" uuid NOT NULL,
        "teamId" uuid NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "paymentStatus" varchar(24) NOT NULL DEFAULT 'pending',
        "waitlistPosition" int,
        "approvedAt" TIMESTAMPTZ,
        "rejectedReason" text,
        "idempotencyKey" varchar(120),
        "version" int NOT NULL DEFAULT 1,
        "deletedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_reg_tournament" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_reg_team" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_registration_team"
      ON "tournament_registrations" ("tournamentId", "teamId")
      WHERE "deletedAt" IS NULL AND "status" NOT IN ('cancelled','rejected','withdrawn')
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_registration_idempotency"
      ON "tournament_registrations" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournament_seeds" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tournamentId" uuid NOT NULL,
        "teamId" uuid NOT NULL,
        "seedNumber" int NOT NULL,
        "isProtected" boolean NOT NULL DEFAULT false,
        CONSTRAINT "fk_seed_tournament" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_seed_tournament_team" UNIQUE ("tournamentId", "teamId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournament_groups" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "stageId" uuid NOT NULL,
        "name" varchar(8) NOT NULL,
        CONSTRAINT "fk_group_stage" FOREIGN KEY ("stageId") REFERENCES "tournament_stages"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "group_members" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "groupId" uuid NOT NULL,
        "teamId" uuid NOT NULL,
        "seed" int,
        CONSTRAINT "fk_gm_group" FOREIGN KEY ("groupId") REFERENCES "tournament_groups"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_gm_group_team" UNIQUE ("groupId", "teamId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournament_matches" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tournamentId" uuid NOT NULL,
        "stageId" uuid NOT NULL,
        "groupId" uuid,
        "status" varchar(24) NOT NULL DEFAULT 'draft',
        "scheduledAt" TIMESTAMPTZ,
        "venueId" uuid,
        "courtKind" varchar(32),
        "courtId" uuid,
        "homeTeamId" uuid,
        "awayTeamId" uuid,
        "homeScore" int,
        "awayScore" int,
        "version" int NOT NULL DEFAULT 1,
        "deletedAt" TIMESTAMPTZ,
        "metadata" jsonb,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_match_tournament" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_match_stage" FOREIGN KEY ("stageId") REFERENCES "tournament_stages"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_matches_tournament_stage"
      ON "tournament_matches" ("tournamentId", "stageId", "scheduledAt") WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournament_fixtures" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "stageId" uuid NOT NULL,
        "groupId" uuid,
        "round" int NOT NULL,
        "matchId" uuid NOT NULL UNIQUE,
        CONSTRAINT "fk_fixture_stage" FOREIGN KEY ("stageId") REFERENCES "tournament_stages"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_fixture_match" FOREIGN KEY ("matchId") REFERENCES "tournament_matches"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bracket_nodes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "stageId" uuid NOT NULL,
        "round" int NOT NULL,
        "slotIndex" int NOT NULL,
        "parentNodeId" uuid,
        "teamId" uuid,
        "isBye" boolean NOT NULL DEFAULT false,
        "winnerAdvancesToNodeId" uuid,
        "matchId" uuid UNIQUE,
        "bracketVersion" int NOT NULL DEFAULT 1,
        CONSTRAINT "fk_bn_stage" FOREIGN KEY ("stageId") REFERENCES "tournament_stages"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_bn_slot" UNIQUE ("stageId", "round", "slotIndex")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "standings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "groupId" uuid NOT NULL,
        "teamId" uuid NOT NULL,
        "played" int NOT NULL DEFAULT 0,
        "won" int NOT NULL DEFAULT 0,
        "drawn" int NOT NULL DEFAULT 0,
        "lost" int NOT NULL DEFAULT 0,
        "goalsFor" int NOT NULL DEFAULT 0,
        "goalsAgainst" int NOT NULL DEFAULT 0,
        "points" int NOT NULL DEFAULT 0,
        "rank" int,
        "tieBreakData" jsonb,
        "manualRankOverride" int,
        CONSTRAINT "fk_standing_group" FOREIGN KEY ("groupId") REFERENCES "tournament_groups"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_standing_group_team" UNIQUE ("groupId", "teamId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournament_payments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "registrationId" uuid NOT NULL,
        "amount" decimal(12,2) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "provider" varchar(32),
        "providerReference" varchar(200),
        "idempotencyKey" varchar(120),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_tp_registration" FOREIGN KEY ("registrationId") REFERENCES "tournament_registrations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_tournament_payment_idempotency"
      ON "tournament_payments" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payment_webhook_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "provider" varchar(32) NOT NULL,
        "eventId" varchar(200) NOT NULL,
        "idempotencyKey" varchar(120) NOT NULL,
        "providerReference" varchar(200),
        "payload" jsonb NOT NULL,
        "processedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_webhook_provider_event" UNIQUE ("provider", "eventId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournament_booking_references" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "matchId" uuid NOT NULL UNIQUE,
        "bookingId" uuid,
        "status" varchar(24) NOT NULL DEFAULT 'active',
        "sagaId" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_tbr_match" FOREIGN KEY ("matchId") REFERENCES "tournament_matches"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournament_audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" uuid NOT NULL,
        "entityType" varchar(64) NOT NULL,
        "entityId" uuid NOT NULL,
        "actorId" uuid,
        "actorIp" varchar(64),
        "reason" text,
        "beforeState" jsonb,
        "afterState" jsonb,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tournament_audit_entity"
      ON "tournament_audit_logs" ("entityType", "entityId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'tournament_audit_logs',
      'tournament_booking_references',
      'payment_webhook_events',
      'tournament_payments',
      'standings',
      'bracket_nodes',
      'tournament_fixtures',
      'tournament_matches',
      'group_members',
      'tournament_groups',
      'tournament_seeds',
      'tournament_registrations',
      'stage_advancement_rules',
      'tournament_stages',
      'tournament_config_versions',
      'tournaments',
      'team_members',
      'teams',
    ];
    for (const t of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
    }
  }
}
