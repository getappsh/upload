import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProgressToReleaseArtifact1736025600000 implements MigrationInterface {
    name = 'AddProgressToReleaseArtifact1736025600000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "release_artifact" ADD "progress" integer NOT NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "release_artifact" DROP COLUMN "progress"`);
    }

}
