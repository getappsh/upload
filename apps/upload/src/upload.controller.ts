import { UploadTopics, UploadTopicsEmit } from '@app/common/microservice-client/topics';
import { RoleInProject, UploadVersionEntity } from '@app/common/database/entities';
import { Controller, Logger } from '@nestjs/common';
import { EventPattern, MessagePattern, RpcException } from '@nestjs/microservices';
import { UploadService } from './upload.service';
import { CreateFileUploadUrlDto, ReleaseArtifactParams, ReleaseParams, SetReleaseArtifactDto, SetReleaseDto, UpdateUploadStatusDto } from '@app/common/dto/upload';
import { RpcPayload } from '@app/common/microservice-client';
import * as fs from 'fs';
import { FileUploadService } from './file-upload.service';
import { ReleaseService } from './releases.service';
import { RegulationStatusService } from './regulation-status.service';
import { RegulationStatusParams, SetRegulationCompliancyDto, SetRegulationStatusDto } from '@app/common/dto/upload';
import { ValidateProjectAnyAccess } from '@app/common/utils/project-access';
import { RegulationChangedEvent } from '@app/common/dto/project-management';


@Controller()
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly fileUploadService: FileUploadService,
    private readonly releasesService: ReleaseService,
    private readonly regulationService: RegulationStatusService

  ) {}
  
  @ValidateProjectAnyAccess()
  @MessagePattern(UploadTopics.UPLOAD_ARTIFACT)
  uploadArtifact(@RpcPayload() data: any): Promise<UploadVersionEntity | RpcException>{
    return this.uploadService.uploadArtifact(data);
  }

  @ValidateProjectAnyAccess()
  @MessagePattern(UploadTopics.UPLOAD_MANIFEST)
  uploadManifest(@RpcPayload() manifest: {any: any}){
    return this.uploadService.uploadManifest(manifest);
  }

  @ValidateProjectAnyAccess()
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


  @ValidateProjectAnyAccess()
  @MessagePattern(UploadTopics.SET_RELEASE)
  setRelease(@RpcPayload() release: SetReleaseDto){
    return this.releasesService.setRelease(release);
  }

  @ValidateProjectAnyAccess()
  @MessagePattern(UploadTopics.GET_RELEASES)
  getReleases(@RpcPayload('projectId') projectId: number){
    return this.releasesService.getReleases(projectId);
  }

  @ValidateProjectAnyAccess()
  @MessagePattern(UploadTopics.GET_RELEASE_BY_VERSION)
  getRelease(@RpcPayload() params: ReleaseParams){
    return this.releasesService.getRelease(params);
  }

  @ValidateProjectAnyAccess()
  @MessagePattern(UploadTopics.DELETE_RELEASE)
  deleteRelease(@RpcPayload() params: ReleaseParams){
    return this.releasesService.deleteRelease(params);
  }

  @ValidateProjectAnyAccess()
  @MessagePattern(UploadTopics.SET_RELEASE_ARTIFACT)
  setReleaseArtifact(@RpcPayload() artifact: SetReleaseArtifactDto){
    return this.releasesService.setReleaseArtifact(artifact);
  }

  @ValidateProjectAnyAccess()
  @MessagePattern(UploadTopics.DELETE_RELEASE_ARTIFACT)
  deleteReleaseArtifact(@RpcPayload() params: ReleaseArtifactParams){
    return this.releasesService.deleteReleaseArtifact(params);
  }

  @ValidateProjectAnyAccess()
  @MessagePattern(UploadTopics.SET_VERSION_REGULATION_STATUS)
  async setRegulationStatus(@RpcPayload() dto: SetRegulationStatusDto) {
    const res = await this.regulationService.setRegulationStatus(dto)
    this.releasesService.refreshReleaseState(dto);
    return res
  }

  @ValidateProjectAnyAccess(RoleInProject.PROJECT_OWNER)
  @MessagePattern(UploadTopics.SET_VERSION_REGULATION_COMPLIANCE)
  async setComplianceStatus(@RpcPayload() dto: SetRegulationCompliancyDto) {
    const res = await this.regulationService.setComplianceStatus(dto)
    this.releasesService.refreshReleaseState(dto);
    return res
  }

  @ValidateProjectAnyAccess()
  @MessagePattern(UploadTopics.GET_VERSION_REGULATION_STATUS_BY_ID)
  getVersionRegulationStatus(@RpcPayload() params: RegulationStatusParams) {
    return this.regulationService.getVersionRegulationStatus(params)
  }

  @ValidateProjectAnyAccess()
  @MessagePattern(UploadTopics.GET_VERSION_REGULATIONS_STATUSES)
  getVersionRegulationsStatuses(@RpcPayload() dto: ReleaseParams) {
    return this.regulationService.getVersionRegulationsStatuses(dto)

  }

  @ValidateProjectAnyAccess()
  @MessagePattern(UploadTopics.DELETE_VERSION_REGULATION_STATUS)
  async deleteVersionRegulationStatus(@RpcPayload() params: RegulationStatusParams) {
    const res = await this.regulationService.deleteVersionRegulationStatus(params)
    this.releasesService.refreshReleaseState(params);
    return res
  }

  @EventPattern(UploadTopicsEmit.PROJECT_REGULATION_CHANGED)
  async onProjectRegulationChanged(@RpcPayload() event: RegulationChangedEvent) {
    await this.releasesService.onProjectRegulationChanged(event);
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
