import { DatabaseModule, UploadJwtConfigService } from '@app/common';
import { RuleModule } from '@app/common/rules';
import { S3Service } from '@app/common/AWS/s3.service';
import { FileUploadEntity, RegulationEntity, RegulationStatusEntity, ReleaseArtifactEntity, ReleaseEntity, UploadVersionEntity, RuleFieldEntity, RuleEntity, RuleReleaseEntity, RuleDeviceTypeEntity, RuleDeviceEntity, RuleOsEntity, DeliveryStatusEntity, DeployStatusEntity } from '@app/common/database/entities';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
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
import { CosignSignatureService } from '@app/common/AWS/cosign-signature.service';
import { PolicyService } from './policy.service';
import { PolicyController } from './policy.controller';
import { FileProcessingService } from '@app/common/AWS/file-processing.service';
import { PermissionsModule } from '@app/common/permissions/permissions.module';

@Module({
  imports: [
    ConfigModule.forRoot({isGlobal: true}),
    LoggerModule.forRoot({httpCls: false, jsonLogger: process.env.LOGGER_FORMAT === 'JSON', name: "Upload"}),
    MicroserviceModule.register({
      name: MicroserviceName.OFFERING_SERVICE,
      type: MicroserviceType.OFFERING,
      id: 'upload'
    }),
    MicroserviceModule.register({
      name: MicroserviceName.DEVICE_SERVICE,
      type: MicroserviceType.DEVICE,
      id: 'upload'
    }),
    MicroserviceModule.register({
      name: MicroserviceName.DELIVERY_SERVICE,
      type: MicroserviceType.DELIVERY,
      id: 'upload'
    }),
    MicroserviceModule.register({
      name: MicroserviceName.DEPLOY_SERVICE,
      type: MicroserviceType.DEPLOY,
      id: 'upload'
    }),
    ApmModule,
    DatabaseModule,
    RuleModule,
    HttpModule,
    JwtModule.registerAsync({
      useClass: UploadJwtConfigService
    }),
    TypeOrmModule.forFeature([
      UploadVersionEntity, 
       FileUploadEntity, 
       ReleaseEntity, 
       ReleaseArtifactEntity, 
       RegulationStatusEntity,
       RegulationEntity,
       RuleFieldEntity,
       RuleEntity,
       RuleReleaseEntity,
       RuleDeviceTypeEntity,
       RuleDeviceEntity,
       RuleOsEntity,
      DeliveryStatusEntity,
      DeployStatusEntity]),
    SafeCronModule,
    MicroserviceModule.register({
      name: MicroserviceName.PROJECT_MANAGEMENT_SERVICE,
      type: MicroserviceType.PROJECT_MANAGEMENT,
      id: 'upload'
    }),
    PermissionsModule.forRoot(),
  ],
  controllers: [UploadController, PolicyController],
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
    CosignSignatureService,
    PolicyService,
    FileProcessingService,
    {
      provide: PROJECT_ACCESS_SERVICE,
      useExisting: UploadService
    }
  ],
})
export class UploadModule {}
