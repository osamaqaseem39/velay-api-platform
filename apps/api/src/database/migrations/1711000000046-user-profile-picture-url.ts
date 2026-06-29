import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserProfilePictureUrl1711000000046 implements MigrationInterface {
  name = 'UserProfilePictureUrl1711000000046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "profilePictureUrl" varchar(500)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "profilePictureUrl"
    `);
  }
}
