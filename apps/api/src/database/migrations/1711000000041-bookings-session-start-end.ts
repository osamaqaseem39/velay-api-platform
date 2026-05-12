import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Whole-booking wall-clock window (first active item → last active item), alongside per-item rows. */
export class BookingsSessionStartEnd1711000000041 implements MigrationInterface {
  name = 'BookingsSessionStartEnd1711000000041';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      ADD COLUMN IF NOT EXISTS "startTime" varchar(5)
    `);
    await queryRunner.query(`
      ALTER TABLE "bookings"
      ADD COLUMN IF NOT EXISTS "endTime" varchar(5)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
      DROP COLUMN IF EXISTS "endTime"
    `);
    await queryRunner.query(`
      ALTER TABLE "bookings"
      DROP COLUMN IF EXISTS "startTime"
    `);
  }
}
