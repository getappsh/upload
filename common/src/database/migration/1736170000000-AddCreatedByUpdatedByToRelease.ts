import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreatedByUpdatedByToRelease1736170000000 implements MigrationInterface {
    name = 'AddCreatedByUpdatedByToRelease1736170000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "release" ADD "created_by" character varying`);
        await queryRunner.query(`ALTER TABLE "release" ADD "updated_by" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "release" DROP COLUMN "updated_by"`);
        await queryRunner.query(`ALTER TABLE "release" DROP COLUMN "created_by"`);
    }
}
