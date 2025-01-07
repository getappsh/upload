import { UploadTopics } from '@app/common/microservice-client/topics';
import { RoleInProject, UploadVersionEntity } from '@app/common/database/entities';
import { Controller, Logger, UseGuards } from '@nestjs/common';
import { MessagePattern, RpcException } from '@nestjs/microservices';
import { TokenVerificationGuard } from './guards/token-verification.guard';
import { UploadService } from './upload.service';
import { CreateFileUploadUrlDto, ReleaseParams, SetReleaseArtifactDto, SetReleaseDto, UpdateUploadStatusDto } from '@app/common/dto/upload';
import { RpcPayload } from '@app/common/microservice-client';
import * as fs from 'fs';
import { FileUploadService } from './file-upload.service';
import { ReleaseService } from './releases.service';
import { TokenVerification } from './decorators/token-verification.decorator';


@Controller()
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly fileUploadService: FileUploadService,
    private readonly releasesService: ReleaseService
  ) {}
  
  @TokenVerification()
  @MessagePattern(UploadTopics.UPLOAD_ARTIFACT)
  uploadArtifact(@RpcPayload() data: any): Promise<UploadVersionEntity | RpcException>{
    return this.uploadService.uploadArtifact(data);
  }

  @TokenVerification()
  @MessagePattern(UploadTopics.UPLOAD_MANIFEST)
  uploadManifest(@RpcPayload() manifest: {any: any}){
    return this.uploadService.uploadManifest(manifest);
  }

  @TokenVerification()
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


  @TokenVerification()
  @MessagePattern(UploadTopics.SET_RELEASE)
  setRelease(@RpcPayload() release: SetReleaseDto){
    return this.releasesService.setRelease(release);
  }

  @TokenVerification()
  @MessagePattern(UploadTopics.GET_RELEASES)
  getReleases(@RpcPayload('projectId') projectId: number){
    return this.releasesService.getReleases(projectId);
  }

  @TokenVerification()
  @MessagePattern(UploadTopics.GET_RELEASE_BY_VERSION)
  getRelease(@RpcPayload() params: ReleaseParams){
    return this.releasesService.getRelease(params);
  }

  @TokenVerification()
  @MessagePattern(UploadTopics.DELETE_RELEASE)
  deleteRelease(@RpcPayload() params: ReleaseParams){
    // return this.releasesService.deleteRelease(params);
    return "Not implemented"
  }

  @TokenVerification()
  @MessagePattern(UploadTopics.SET_RELEASE_ARTIFACT)
  setReleaseArtifact(@RpcPayload() artifact: SetReleaseArtifactDto){
    return this.releasesService.setReleaseArtifact(artifact);
  }

  @TokenVerification()
  @MessagePattern(UploadTopics.DELETE_RELEASE_ARTIFACT)
  deleteReleaseArtifact(@RpcPayload() params: ReleaseParams){
    // return this.releasesService.deleteReleaseArtifact(params);
    return "Not implemented"
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
