import * as dotenv from 'dotenv';
dotenv.config();
import apm from 'nestjs-elastic-apm';

import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { CustomRpcExceptionFilter } from './rpc-exception.filter';
import { UploadModule } from './upload.module';
import { MSType, MicroserviceName, MicroserviceType, getClientConfig } from '@app/common/microservice-client';
import { GET_APP_LOGGER } from '@app/common/logger/logger.module';


async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    UploadModule,
    {...getClientConfig(
      {
        type: MicroserviceType.UPLOAD, 
        name: MicroserviceName.UPLOAD_SERVICE
      }, 
      MSType[process.env.MICRO_SERVICE_TYPE]),
      bufferLogs: true
    }
  );
  app.useLogger(app.get(GET_APP_LOGGER))
  app.useGlobalFilters(new CustomRpcExceptionFilter())
  app.listen()
}
bootstrap();
