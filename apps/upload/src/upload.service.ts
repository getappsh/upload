import { S3Service } from '@app/common/AWS/s3.service';
import { ProjectEntity, UploadVersionEntity, UploadStatus, DeviceComponentEntity, DeviceEntity, DeviceComponentStateEnum } from '@app/common/database/entities';
import { ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { DockerDownloadService } from './docker-download.service';
import { ComponentDto } from '@app/common/dto/discovery';
import { UpdateUploadStatusDto, UploadEventDto, UploadEventEnum } from '@app/common/dto/upload';
import { MicroserviceClient, MicroserviceName } from '@app/common/microservice-client';
import { OfferingTopicsEmit } from '@app/common/microservice-client/topics';



@Injectable()
export class UploadService {

  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly s3Service: S3Service,
    private readonly dockerDownloadService: DockerDownloadService,
    private readonly jwtService: JwtService,
    @InjectRepository(UploadVersionEntity) private readonly uploadVersionRepo: Repository<UploadVersionEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(DeviceComponentEntity) private readonly deviceCompRepo: Repository<DeviceComponentEntity>,
    @Inject(MicroserviceName.OFFERING_SERVICE) private readonly offeringClient: MicroserviceClient,

  ) { }


  private async moveImageToS3(artifactDto: any, uploadVersion: UploadVersionEntity) {
    this.logger.debug("Start process of Moving Image To S3");
    uploadVersion.uploadStatus = UploadStatus.DOWNLOADING_FROM_URL;
    this.uploadVersionRepo.save(uploadVersion);

    let imagePath: string;
    try {
      imagePath = await this.dockerDownloadService.downloadDockerImage(artifactDto.url);
      this.logger.debug(`Image saved at ${imagePath}`);
    } catch (error) {
      uploadVersion.uploadStatus = UploadStatus.FAIL_TO_DOWNLOAD;
      this.uploadVersionRepo.save(uploadVersion);
      this.logger.error(error)
      return
    }

    uploadVersion.uploadStatus = UploadStatus.UPLOADING_TO_S3;
    this.uploadVersionRepo.save(uploadVersion);
    this.logger.debug(`Start Upload Image To S3`)
    let objectKey: string
    try {
      objectKey = `${artifactDto.platform}/${artifactDto.component}/${artifactDto.formation}/${artifactDto.version}/${artifactDto.version}.tar`
      await this.s3Service.uploadFile(imagePath, objectKey)
    } catch (error) {
      uploadVersion.uploadStatus = UploadStatus.FAIL_TO_UPLOAD;
      this.uploadVersionRepo.save(uploadVersion);

      this.logger.error(error)
      return
    }
    uploadVersion.uploadStatus = UploadStatus.READY;
    uploadVersion.s3Url = objectKey;
    this.uploadVersionRepo.save(uploadVersion);

    this.logger.debug(`Image saved on s3 at ${objectKey}`);

    this.dockerDownloadService.deleteImageDir(imagePath)
  }

  async uploadArtifact(artifactDto: any): Promise<UploadVersionEntity> {
    delete artifactDto.uploadToken;
    let newVersion = UploadVersionEntity.fromArtifact({ ...artifactDto });

    try {
      newVersion = await this.uploadVersionRepo.save(newVersion);
    } catch (error) {
      if (error.code = '23505') {
        throw new ConflictException("Version is already exist");
      }
      this.logger.error(error);
    }
    this.moveImageToS3(artifactDto, newVersion);
    return newVersion
  }

  async uploadManifest(manifest: any) {
    this.logger.debug(`new upload version of manifest type component: ${manifest.name}, version: ${manifest.version}`)
    delete manifest.uploadToken;


    const fileName = manifest?.fileName || `${manifest.version}.zip`
    const url = `${manifest.product}/${manifest.name}/${manifest.formation}/${manifest.version}/${fileName}`
    const newUpload = UploadVersionEntity.fromManifest({ ...manifest, url: url });

    const existsVersion = await this.uploadVersionRepo.findOne({
      where: {
        platform: newUpload.platform,
        component: newUpload.component,
        formation: newUpload.formation,
        version: newUpload.version
      }
    })
    let newVersion: UploadVersionEntity;
    if (existsVersion?.uploadStatus == UploadStatus.ERROR) {
      newVersion = existsVersion
    } else {
      try {
        newVersion = await this.uploadVersionRepo.save(newUpload);
      } catch (error) {
        if (error.code = '23505') {
          throw new ConflictException("Version is already exist");
        }
        this.logger.error(error);
      }
    }
    return { catalogId: newVersion.catalogId, uploadUrl: await this.s3Service.generatePresignedUrlForUpload(url) }
  }

  async updateUploadStatus(updateUploadStatusDto: UpdateUploadStatusDto) {
    this.logger.log(`Update upload status for: ${updateUploadStatusDto.catalogId}, status: ${updateUploadStatusDto.status}`)
    const result = await this.uploadVersionRepo.update({ catalogId: updateUploadStatusDto.catalogId }, { uploadStatus: updateUploadStatusDto.status })
    if (result.affected === 0) {
      throw new NotFoundException(`Upload with ID ${updateUploadStatusDto.catalogId} not found`);
    }

    this.updateLatestFlag(updateUploadStatusDto)
    return {};

  }

  private async updateLatestFlag(updateUploadStatusDto: UpdateUploadStatusDto) {
    this.logger.log(`Update latest flag`)
    const base  = await this.uploadVersionRepo.findOneBy({catalogId: updateUploadStatusDto.catalogId});
    if (!base){
      this.logger.warn(`not found upload with catalogId: ${updateUploadStatusDto.catalogId}`)
      return
    }
  
    await this.uploadVersionRepo
    .createQueryBuilder()
    .update()
    .set({ latest: false })
    .where('platform = :platform AND component = :component AND formation = :formation AND latest = true', {
      platform: base.platform,
      component: base.component,
      formation: base.formation,
    })
    .returning('catalog_id')
    .execute()

    const latestUpload = await this.uploadVersionRepo.findOne({
      where: {platform: base.platform, component: base.component, formation: base.formation, uploadStatus: UploadStatus.READY},
      order: {createdDate: 'DESC'},
    })

    let status
    if (base.uploadStatus === UploadStatus.ERROR){
      status = UploadEventEnum.ERROR
    }else if(base.uploadStatus === UploadEventEnum.READY){
      status = UploadEventEnum.READY
    }
    let isBaseLatest = latestUpload?.catalogId == base.catalogId;
    if (status){
      let event = new UploadEventDto(base.catalogId, base.component, base.platform, base.formation, base.OS, status, isBaseLatest);
      this.sendUploadEvent(event)
    }

    if (latestUpload){
      latestUpload.latest = true;
      this.uploadVersionRepo.save(latestUpload)
      this.logger.log(`set ${JSON.stringify(latestUpload)}, as latest`);
    }   
  }

  private async sendUploadEvent(event: UploadEventDto){
    this.logger.log(`Send Upload event: ${event}`);
    this.offeringClient.emit(OfferingTopicsEmit.COMPONENT_UPLOAD_EVENT, event);
  }
  

  async getLastVersion(params: {projectId: number}) {
    let comp =  await this.uploadVersionRepo.findOne({
      where: {
        project: {
          id: params.projectId
        }
      },
      order: {
        version: 'DESC'
      },
    })

    if (!comp) {
      this.logger.warn(`Component not found, projectId ${params.projectId}`);
      throw new NotFoundException('Component not found');

    }
    return ComponentDto.fromUploadVersionEntity(comp);
  }

  async verifyToken(token: string) {
    const payload = this.jwtService.verify(token)
    const project = await this.projectRepo.findOne({ where: { id: payload.data.projectId } })
    if (!project.tokens.includes(token)) {
      throw new HttpException('Not Allowed in this project ', HttpStatus.FORBIDDEN);
    }
    return project;
  }
}
