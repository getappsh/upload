import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { UploadTopics } from '@app/common/microservice-client/topics';
import { RpcPayload, UserContextInterceptor } from '@app/common/microservice-client';
import { ConfigService } from './config.service';
import {
  AddConfigMapAssociationDto,
  ApplyConfigRevisionDto,
  CreateDraftRevisionDto,
  DeleteConfigGroupDto,
  DeleteDraftRevisionDto,
  GetConfigRevisionByIdDto,
  GetConfigRevisionsDto,
  GetDeviceConfigByVersionDto,
  GetDeviceConfigDto,
  RemoveConfigMapAssociationDto,
  UpsertConfigGroupDto,
} from '@app/common/dto/project-management';

@Controller()
@UseInterceptors(UserContextInterceptor)
export class ConfigController {
  private readonly logger = new Logger(ConfigController.name);

  constructor(private readonly configService: ConfigService) {}

  // ---------------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------------

  @MessagePattern(UploadTopics.CONFIG_UPSERT_GROUP)
  upsertGroup(@RpcPayload() dto: UpsertConfigGroupDto) {
    return this.configService.upsertGroup(dto);
  }

  @MessagePattern(UploadTopics.CONFIG_DELETE_GROUP)
  deleteGroup(@RpcPayload() dto: DeleteConfigGroupDto) {
    return this.configService.deleteGroup(dto);
  }

  // ---------------------------------------------------------------------------
  // Revisions
  // ---------------------------------------------------------------------------

  @MessagePattern(UploadTopics.CONFIG_APPLY_REVISION)
  applyRevision(@RpcPayload() dto: ApplyConfigRevisionDto) {
    return this.configService.applyRevision(dto);
  }

  @MessagePattern(UploadTopics.CONFIG_GET_REVISIONS)
  getRevisions(@RpcPayload() dto: GetConfigRevisionsDto) {
    return this.configService.getRevisions(dto);
  }

  @MessagePattern(UploadTopics.CONFIG_GET_REVISION_BY_ID)
  getRevisionById(@RpcPayload() dto: GetConfigRevisionByIdDto) {
    return this.configService.getRevisionById(dto);
  }

  @MessagePattern(UploadTopics.CONFIG_CREATE_DRAFT_REVISION)
  createDraftRevision(@RpcPayload() dto: CreateDraftRevisionDto) {
    return this.configService.createDraftRevision(dto);
  }

  @MessagePattern(UploadTopics.CONFIG_DELETE_DRAFT_REVISION)
  deleteDraftRevision(@RpcPayload() dto: DeleteDraftRevisionDto) {
    return this.configService.deleteDraftRevision(dto);
  }

  // ---------------------------------------------------------------------------
  // ConfigMap associations
  // ---------------------------------------------------------------------------

  @MessagePattern(UploadTopics.CONFIG_ADD_MAP_ASSOCIATION)
  addConfigMapAssociation(@RpcPayload() dto: AddConfigMapAssociationDto) {
    return this.configService.addConfigMapAssociation(dto);
  }

  @MessagePattern(UploadTopics.CONFIG_REMOVE_MAP_ASSOCIATION)
  removeConfigMapAssociation(@RpcPayload() dto: RemoveConfigMapAssociationDto) {
    return this.configService.removeConfigMapAssociation(dto);
  }

  @MessagePattern(UploadTopics.CONFIG_GET_MAP_ASSOCIATIONS)
  getConfigMapAssociations(@RpcPayload() payload: { configMapProjectIdentifier: number | string }) {
    return this.configService.getConfigMapAssociations(payload.configMapProjectIdentifier);
  }

  @MessagePattern(UploadTopics.CONFIG_GET_CONFIG_MAPS_FOR_PROJECT)
  getConfigMapsForProject(@RpcPayload() payload: { projectIdentifier: number | string }) {
    return this.configService.getConfigMapsForProject(payload.projectIdentifier);
  }

  // ---------------------------------------------------------------------------
  // Agent endpoint – get final device config
  // ---------------------------------------------------------------------------

  @MessagePattern(UploadTopics.CONFIG_GET_DEVICE_CONFIG)
  getDeviceConfig(@RpcPayload() dto: GetDeviceConfigDto) {
    return this.configService.getDeviceConfig(dto);
  }

  @MessagePattern(UploadTopics.CONFIG_GET_DEVICE_CONFIG_BY_VERSION)
  getDeviceConfigByVersion(@RpcPayload() dto: GetDeviceConfigByVersionDto) {
    return this.configService.getDeviceConfigByVersion(dto);
  }

  @MessagePattern(UploadTopics.CONFIG_PROVISION_PROJECT_CONTENT)
  provisionProjectContent(@RpcPayload() payload: { projectId: number; deviceId: string; deviceTypeIds?: number[] }) {
    return this.configService.provisionProjectContent(payload);
  }

  @MessagePattern(UploadTopics.CONFIG_GET_ACTIVE_SEMVER_FOR_DEVICE)
  getActiveConfigSemVerForDevice(@RpcPayload() payload: string | { deviceId: string }) {
    const deviceId = typeof payload === 'string' ? payload : payload.deviceId;
    return this.configService.getActiveConfigSemVerForDevice(deviceId);
  }
}
