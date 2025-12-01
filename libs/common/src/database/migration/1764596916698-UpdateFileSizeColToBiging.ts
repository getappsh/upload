import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateFileSizeColToBiging1764596916698 implements MigrationInterface {
    name = 'UpdateFileSizeColToBiging1764596916698'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "file_upload" ALTER COLUMN "size" TYPE bigint`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "file_upload" ALTER COLUMN "size" TYPE integer`);
    }

}
