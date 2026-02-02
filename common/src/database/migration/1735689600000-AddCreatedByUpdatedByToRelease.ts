import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreatedByUpdatedByToRelease1735689600000 implements MigrationInterface {
    name = 'AddCreatedByUpdatedByToRelease1735689600000'
    public async up(_queryRunner: QueryRunner): Promise<void> {
        // no-op migration stub (ordering placeholder)
        return Promise.resolve();
    }

    public async down(_queryRunner: QueryRunner): Promise<void> {
        // no-op
        return Promise.resolve();
    }
}
