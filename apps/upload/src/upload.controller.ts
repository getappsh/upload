import { UploadTopics } from '@app/common/microservice-client/topics';
import { UploadVersionEntity } from '@app/common/database/entities';
import { Controller, UseGuards } from '@nestjs/common';
import { MessagePattern, RpcException } from '@nestjs/microservices';
import { TokenVerificationGuard } from './guards/token-verification.guard';
import { UploadService } from './upload.service';

@Controller()
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}
  
  @UseGuards(TokenVerificationGuard)
  @MessagePattern(UploadTopics.UPLOAD_ARTIFACT)
  uploadArtifact(data: any): Promise<UploadVersionEntity | RpcException>{
    return this.uploadService.uploadArtifact(data);
  }

  @UseGuards(TokenVerificationGuard)
  @MessagePattern(UploadTopics.UPLOAD_MANIFEST)
  uploadManifest(manifest: {any: any}){
    return this.uploadService.uploadManifest(manifest);
  }


  @UseGuards(TokenVerificationGuard)
  @MessagePattern(UploadTopics.UPDATE_UPLOAD_STATUS)
  updateUploadStatus(updateUploadStatusDto: {any: any}){
    return this.uploadService.updateUploadStatus(updateUploadStatusDto);
  }

  @MessagePattern(UploadTopics.LAST_VERSION)
  getLastVersion(params: {projectId: number}){
    return this.uploadService.getLastVersion(params);
  }

  @MessagePattern(UploadTopics.CHECK_HEALTH)
  healthCheckSuccess(){
    return "Upload service is success"
  }
}
