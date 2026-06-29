import { MigrationInterface, QueryRunner } from 'typeorm';

export class TournamentDivisions1711000000054 implements MigrationInterface {
  name = 'TournamentDivisions1711000000054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tournament_divisions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tournamentId" uuid NOT NULL,
        "sport" varchar(64) NOT NULL,
        "label" varchar(120),
        "displayOrder" int NOT NULL DEFAULT 0,
        "registrationOpensAt" TIMESTAMPTZ,
        "registrationClosesAt" TIMESTAMPTZ,
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
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_division_tournament" FOREIGN KEY ("tournamentId")
          REFERENCES "tournaments"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_divisions_tournament"
      ON "tournament_divisions" ("tournamentId") WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_division_tournament_sport"
      ON "tournament_divisions" ("tournamentId", "sport")
      WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE TEMP TABLE "_tournament_event_map" ON COMMIT DROP AS
      SELECT
        t."id" AS "divisionId",
        gen_random_uuid() AS "eventId",
        t."tenantId",
        t."name",
        t."venueIds",
        t."startsAt",
        t."endsAt",
        t."deletedAt",
        t."createdAt",
        t."updatedAt"
      FROM "tournaments" t
    `);

    await queryRunner.query(`
      INSERT INTO "tournaments" (
        "id", "tenantId", "name", "sport", "venueIds",
        "registrationOpensAt", "registrationClosesAt",
        "startsAt", "endsAt", "maxTeams", "entryFeeAmount", "entryFeeCurrency",
        "prizePool", "rules", "structureType", "status",
        "currentConfigVersionId", "version", "deletedAt", "createdAt", "updatedAt"
      )
      SELECT
        m."eventId",
        t."tenantId",
        t."name",
        t."sport",
        t."venueIds",
        t."registrationOpensAt",
        t."registrationClosesAt",
        t."startsAt",
        t."endsAt",
        t."maxTeams",
        t."entryFeeAmount",
        t."entryFeeCurrency",
        t."prizePool",
        t."rules",
        t."structureType",
        t."status",
        t."currentConfigVersionId",
        t."version",
        t."deletedAt",
        t."createdAt",
        t."updatedAt"
      FROM "tournaments" t
      JOIN "_tournament_event_map" m ON m."divisionId" = t."id"
    `);

    await queryRunner.query(`
      INSERT INTO "tournament_divisions" (
        "id", "tournamentId", "sport", "displayOrder",
        "registrationOpensAt", "registrationClosesAt",
        "maxTeams", "entryFeeAmount", "entryFeeCurrency",
        "prizePool", "rules", "structureType", "status",
        "currentConfigVersionId", "version", "deletedAt",
        "createdAt", "updatedAt"
      )
      SELECT
        m."divisionId",
        m."eventId",
        t."sport",
        0,
        t."registrationOpensAt",
        t."registrationClosesAt",
        t."maxTeams",
        t."entryFeeAmount",
        t."entryFeeCurrency",
        t."prizePool",
        t."rules",
        t."structureType",
        t."status",
        t."currentConfigVersionId",
        t."version",
        t."deletedAt",
        t."createdAt",
        t."updatedAt"
      FROM "tournaments" t
      JOIN "_tournament_event_map" m ON m."divisionId" = t."id"
    `);

    await queryRunner.query(`
      DELETE FROM "tournaments" t
      USING "_tournament_event_map" m
      WHERE t."id" = m."divisionId"
    `);

    const childTables = [
      'tournament_config_versions',
      'tournament_stages',
      'tournament_registrations',
      'tournament_seeds',
      'tournament_matches',
    ];

    for (const table of childTables) {
      const exists = await queryRunner.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = '${table}'
      `);
      if (!exists.length) continue;

      await queryRunner.query(`
        ALTER TABLE "${table}"
        RENAME COLUMN "tournamentId" TO "divisionId"
      `);
    }

    await queryRunner.query(`
      ALTER TABLE "tournament_config_versions"
      DROP CONSTRAINT IF EXISTS "fk_tcv_tournament"
    `);
    await queryRunner.query(`
      ALTER TABLE "tournament_config_versions"
      ADD CONSTRAINT "fk_tcv_division"
      FOREIGN KEY ("divisionId") REFERENCES "tournament_divisions"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "tournament_config_versions"
      DROP CONSTRAINT IF EXISTS "uq_tcv_tournament_version"
    `);
    await queryRunner.query(`
      ALTER TABLE "tournament_config_versions"
      ADD CONSTRAINT "uq_tcv_division_version" UNIQUE ("divisionId", "version")
    `);

    await queryRunner.query(`
      ALTER TABLE "tournament_stages"
      DROP CONSTRAINT IF EXISTS "fk_stage_tournament"
    `);
    await queryRunner.query(`
      ALTER TABLE "tournament_stages"
      ADD CONSTRAINT "fk_stage_division"
      FOREIGN KEY ("divisionId") REFERENCES "tournament_divisions"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "tournament_stages"
      DROP CONSTRAINT IF EXISTS "uq_stage_tournament_order"
    `);
    await queryRunner.query(`
      ALTER TABLE "tournament_stages"
      ADD CONSTRAINT "uq_stage_division_order" UNIQUE ("divisionId", "order")
    `);

    await queryRunner.query(`
      ALTER TABLE "tournament_registrations"
      DROP CONSTRAINT IF EXISTS "fk_reg_tournament"
    `);
    await queryRunner.query(`
      ALTER TABLE "tournament_registrations"
      ADD CONSTRAINT "fk_reg_division"
      FOREIGN KEY ("divisionId") REFERENCES "tournament_divisions"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_registration_team"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_registration_team"
      ON "tournament_registrations" ("divisionId", "teamId")
      WHERE "deletedAt" IS NULL AND "status" NOT IN ('cancelled','rejected','withdrawn')
    `);

    const seedsExists = await queryRunner.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'tournament_seeds'
    `);
    if (seedsExists.length) {
      await queryRunner.query(`
        ALTER TABLE "tournament_seeds"
        DROP CONSTRAINT IF EXISTS "fk_seed_tournament"
      `);
      await queryRunner.query(`
        ALTER TABLE "tournament_seeds"
        ADD CONSTRAINT "fk_seed_division"
        FOREIGN KEY ("divisionId") REFERENCES "tournament_divisions"("id") ON DELETE CASCADE
      `);
      await queryRunner.query(`
        ALTER TABLE "tournament_seeds"
        DROP CONSTRAINT IF EXISTS "uq_seed_tournament_team"
      `);
      await queryRunner.query(`
        ALTER TABLE "tournament_seeds"
        ADD CONSTRAINT "uq_seed_division_team" UNIQUE ("divisionId", "teamId")
      `);
    }

    await queryRunner.query(`
      ALTER TABLE "tournament_matches"
      DROP CONSTRAINT IF EXISTS "fk_match_tournament"
    `);
    await queryRunner.query(`
      ALTER TABLE "tournament_matches"
      ADD CONSTRAINT "fk_match_division"
      FOREIGN KEY ("divisionId") REFERENCES "tournament_divisions"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_matches_tournament_stage"
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_matches_division_stage"
      ON "tournament_matches" ("divisionId", "stageId", "scheduledAt") WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "sport"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "registrationOpensAt"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "registrationClosesAt"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "maxTeams"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "entryFeeAmount"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "entryFeeCurrency"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "prizePool"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "rules"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "structureType"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "status"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "currentConfigVersionId"`);
    await queryRunner.query(`ALTER TABLE "tournaments" DROP COLUMN IF EXISTS "version"`);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_tournaments_tenant_status"
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_tournaments_tenant"
      ON "tournaments" ("tenantId") WHERE "deletedAt" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_divisions_status"
      ON "tournament_divisions" ("status") WHERE "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "sport" varchar(64)`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "registrationOpensAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "registrationClosesAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "maxTeams" int`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "entryFeeAmount" decimal(12,2)`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "entryFeeCurrency" varchar(8) DEFAULT 'PKR'`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "prizePool" jsonb`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "rules" text`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "structureType" varchar(48)`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "status" varchar(32) DEFAULT 'draft'`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "currentConfigVersionId" uuid`);
    await queryRunner.query(`ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "version" int DEFAULT 1`);

    await queryRunner.query(`
      UPDATE "tournaments" e SET
        "sport" = d."sport",
        "registrationOpensAt" = d."registrationOpensAt",
        "registrationClosesAt" = d."registrationClosesAt",
        "maxTeams" = d."maxTeams",
        "entryFeeAmount" = d."entryFeeAmount",
        "entryFeeCurrency" = d."entryFeeCurrency",
        "prizePool" = d."prizePool",
        "rules" = d."rules",
        "structureType" = d."structureType",
        "status" = d."status",
        "currentConfigVersionId" = d."currentConfigVersionId",
        "version" = d."version"
      FROM "tournament_divisions" d
      WHERE d."tournamentId" = e."id" AND d."displayOrder" = 0
    `);

    const childTables = [
      'tournament_config_versions',
      'tournament_stages',
      'tournament_registrations',
      'tournament_seeds',
      'tournament_matches',
    ];
    for (const table of childTables) {
      const exists = await queryRunner.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = '${table}'
      `);
      if (!exists.length) continue;
      await queryRunner.query(`
        ALTER TABLE "${table}" RENAME COLUMN "divisionId" TO "tournamentId"
      `);
    }

    await queryRunner.query(`DROP TABLE IF EXISTS "tournament_divisions" CASCADE`);
  }
}
