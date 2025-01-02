import { UploadTopics } from '@app/common/microservice-client/topics';
import { UploadVersionEntity } from '@app/common/database/entities';
import { Controller, Logger, UseGuards } from '@nestjs/common';
import { MessagePattern, RpcException } from '@nestjs/microservices';
import { TokenVerificationGuard } from './guards/token-verification.guard';
import { UploadService } from './upload.service';
import { CreateFileUploadUrlDto, UpdateUploadStatusDto } from '@app/common/dto/upload';
import { RpcPayload } from '@app/common/microservice-client';
import * as fs from 'fs';
import { FileUploadService } from './file-upload.service';


@Controller()
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly fileUploadService: FileUploadService,
  ) {}
  
  @UseGuards(TokenVerificationGuard)
  @MessagePattern(UploadTopics.UPLOAD_ARTIFACT)
  uploadArtifact(@RpcPayload() data: any): Promise<UploadVersionEntity | RpcException>{
    return this.uploadService.uploadArtifact(data);
  }

  @UseGuards(TokenVerificationGuard)
  @MessagePattern(UploadTopics.UPLOAD_MANIFEST)
  uploadManifest(@RpcPayload() manifest: {any: any}){
    return this.uploadService.uploadManifest(manifest);
  }


  @UseGuards(TokenVerificationGuard)
  @MessagePattern(UploadTopics.UPDATE_UPLOAD_STATUS)
  updateUploadStatus(@RpcPayload() updateUploadStatusDto: UpdateUploadStatusDto){
    return this.uploadService.updateUploadStatus(updateUploadStatusDto);
  }

  @MessagePattern(UploadTopics.LAST_VERSION)
  getLastVersion(@RpcPayload() params: {projectId: number}){
    return this.uploadService.getLastVersion(params);
  }

  @MessagePattern(UploadTopics.CREATE_FILE_UPLOAD_URL)
  createFileUploadUrl(@RpcPayload() dto: CreateFileUploadUrlDto) {
    return this.fileUploadService.createFileUploadUrl(dto);
  }

  @MessagePattern(UploadTopics.CHECK_HEALTH)
  healthCheckSuccess(){
    const version = this.readImageVersion()
    this.logger.log(`Upload service - Health checking, Version: ${version}`)
    return "Upload service is running successfully. Version: " + version
  }

  private readImageVersion(){
    let version = 'unknown'
    try{
      version = fs.readFileSync('NEW_TAG.txt','utf8');
    }catch(error){
      this.logger.error(`Unable to read image version - error: ${error}`)
    }
    return version
  }
}
