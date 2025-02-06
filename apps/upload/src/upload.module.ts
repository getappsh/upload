import { DatabaseModule, UploadJwtConfigService } from '@app/common';
import { S3Service } from '@app/common/AWS/s3.service';
import { FileUploadEntity, MemberEntity, MemberProjectEntity, ProjectEntity, RegulationEntity, RegulationStatusEntity, ReleaseArtifactEntity, ReleaseEntity, UploadVersionEntity} from '@app/common/database/entities';
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
import { SafeCronModule } from '@app/common/safe-cron';
import { ReleaseService } from './releases.service';
import { RegulationStatusService } from './regulation-status.service';
import { RegulationEnforcementService } from './regulation-enforcement.service';
import { JUnitParserService } from './utils/junit-parser.service';
import { PROJECT_ACCESS_SERVICE } from '@app/common/utils/project-access';

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
    TypeOrmModule.forFeature([
      UploadVersionEntity, 
      ProjectEntity,
       FileUploadEntity, 
       ReleaseEntity, 
       ReleaseArtifactEntity, 
       MemberProjectEntity,
       RegulationStatusEntity,
       RegulationEntity]),
    SafeCronModule,
    MicroserviceModule.register({
      name: MicroserviceName.PROJECT_MANAGEMENT_SERVICE,
      type: MicroserviceType.PROJECT_MANAGEMENT,
    }),
  ],
  controllers: [UploadController],
  providers: [
    UploadService, 
    S3Service, 
    DockerDownloadService, 
    FileUploadService, 
    MinioClientService, 
    ReleaseService,
    RegulationStatusService,
    RegulationEnforcementService,
    JUnitParserService,
    {
      provide: PROJECT_ACCESS_SERVICE,
      useExisting: UploadService
    }
  ],
})
export class UploadModule {}
