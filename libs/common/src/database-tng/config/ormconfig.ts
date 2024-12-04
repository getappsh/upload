import 'dotenv/config';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { readFileSync } from 'fs'
import { DeliveryEntity } from '../../database/entities/delivery.entity';

const region = process.env.REGION ? `_${process.env.REGION}` : '';

const ormConfig = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  database: `${process.env.POSTGRES_DB}${region}`,
  username: process.env.POSTGRES_USER,

  ...getDBAuthParams(),
  entities: [
    DeliveryEntity
  ],
  migrations: [join(__dirname, '../migration/*.ts')],
  logging: false,
  synchronize: false,
  migrationsTableName: "history",
});

function getDBAuthParams() {
  switch (process.env.DEPLOY_ENV) {
    case "CTS":
    case "TNG":
      return {
        ssl: {
          key: [readFileSync(process.env.DB_KEY_PATH)],
          cert: [readFileSync(process.env.DB_CERT_PATH)]
        }
      }

    default:
      return {
        password: process.env.POSTGRES_PASSWORD,
      }
  }
}
export default ormConfig;