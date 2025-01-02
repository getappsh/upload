import { DatabaseModule, UploadJwtConfigService } from '@app/common';
import { S3Service } from '@app/common/AWS/s3.service';
import { FileUploadEntity, MemberEntity, MemberProjectEntity, ProjectEntity, UploadVersionEntity} from '@app/common/database/entities';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DockerDownloadService } from './docker-download.service';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { LoggerModule } from '@app/common/logger/logger.module';
import { ApmModule } from '@app/common/apm/apm.module';
import { MicroserviceModule, MicroserviceName, MicroserviceType } from '@app/common/microservice-client';
import { FileUploadService } from './file-upload.service';
import { MinioClientService } from '@app/common/AWS/minio-client.service';

@Module({
  imports: [
    ConfigModule.forRoot({isGlobal: true}),
    LoggerModule.forRoot({httpCls: false, jsonLogger: process.env.LOGGER_FORMAT === 'JSON', name: "Upload"}),
    MicroserviceModule.register({
      name: MicroserviceName.OFFERING_SERVICE,
      type: MicroserviceType.OFFERING,
    }),
    ApmModule,
    DatabaseModule,
    JwtModule.registerAsync({
      useClass: UploadJwtConfigService
    }),
    TypeOrmModule.forFeature([UploadVersionEntity, ProjectEntity, FileUploadEntity]),
  ],
  controllers: [UploadController],
  providers: [UploadService, S3Service, DockerDownloadService, FileUploadService, MinioClientService],
})
export class UploadModule {}
