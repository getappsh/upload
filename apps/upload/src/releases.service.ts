import { ReleaseEntity, ReleaseArtifactEntity, ProjectEntity, ReleaseStatusEnum, ArtifactTypeEnum, FileUploadEntity, RegulationEntity, FileUPloadStatusEnum } from "@app/common/database/entities";
import { SetReleaseArtifactDto, SetReleaseArtifactResDto, CreateFileUploadUrlDto, SetReleaseDto, ReleaseParams, ReleaseDto, ReleaseArtifactDto, ReleaseArtifactParams } from "@app/common/dto/upload";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FileUploadService } from "./file-upload.service";
import { UpsertOptions } from "typeorm/repository/UpsertOptions";
import * as semver from 'semver';
import { RegulationStatusService } from "./regulation-status.service";


@Injectable()
export class ReleaseService {
  private readonly logger = new Logger(ReleaseService.name);

  constructor(
    @InjectRepository(ReleaseEntity) private readonly releaseRepo: Repository<ReleaseEntity>,
    @InjectRepository(ReleaseArtifactEntity) private readonly artifactRepo: Repository<ReleaseArtifactEntity>,
    @InjectRepository(RegulationEntity) private readonly regulationRepo: Repository<RegulationEntity>,
    private readonly fileUploadService: FileUploadService,
    private readonly regulationService: RegulationStatusService,
  ){

    this.fileUploadService.onFileCreate(file => this.onFileCreate(file));
    this.fileUploadService.onFileDelete(file => this.onFileDelete(file));
  }
  
  async setRelease(dto: SetReleaseDto): Promise<ReleaseDto>{
    this.logger.log(`Setting release for project: ${dto.projectId}, version: ${dto.version}`);

    const releaseEntity = this.releaseRepo.create();
    releaseEntity.project = { id: dto.projectId } as unknown as ProjectEntity;
    releaseEntity.version = dto.version;
    releaseEntity.name = dto?.name;
    releaseEntity.releaseNotes = dto?.releaseNotes;;
    releaseEntity.metadata = dto?.metadata;
    releaseEntity.status = dto?.isDraft === true ? ReleaseStatusEnum.DRAFT : ReleaseStatusEnum.IN_REVIEW;

    this.logger.debug(`Saving release: ${JSON.stringify(releaseEntity)}`);
    await this.releaseRepo.upsert(releaseEntity, ['project', 'version']);

    await this.refreshReleaseState(dto);

    return this.getRelease(dto);
  }

  
  async getRelease(params: ReleaseParams): Promise<ReleaseDto>{
    this.logger.log(`Getting release for project: ${params.projectId}, version: ${params.version}`);

    return this.releaseRepo.findOne({
      where:{
        project: {id: params.projectId}, 
        version: params.version
      },
      relations: {
        artifacts: {fileUpload: true}
        
      }
    }).then((release) => {
      if (!release){
        throw new NotFoundException(`Release not found for project: ${params.projectId}, version: ${params.version}`);
      }
      return ReleaseDto.fromEntity(release);
    })
  }

  async getReleases(projectId: number): Promise<ReleaseDto[]>{
    this.logger.log(`Getting releases for project: ${projectId}`);
    const releases = await this.releaseRepo.find({
      where: {
        project: {id: projectId}
      }
    })
    
    return releases
    .sort((a, b) => {
      try {
        return semver.rcompare(a.version, b.version)
      } catch (error) {
        this.logger.warn(`Error comparing versions: ${a.version}, ${b.version}`);
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
    })
    .map((release) => ReleaseDto.fromEntity(release));
  }
  

  async deleteRelease(params: ReleaseParams): Promise<string>{
    this.logger.log(`Deleting release of project: ${params.projectId}, version: ${params.version}`);
    const release = await this.getRelease(params);
    
    const regulationStatuses = await this.regulationService.getVersionRegulationsStatuses(params);
    for (const regulationStatus of regulationStatuses) {
      await this.regulationService.deleteVersionRegulationStatus({regulation: regulationStatus.regulation, ...params})
      .catch(err => this.logger.error(`Error deleting regulation status: ${regulationStatus.regulation}, error: ${err}`));
    }

    for (const artifact of release.artifacts) {
      await this.deleteReleaseArtifact({artifactId: artifact.id, ...params})
      .catch(err => this.logger.error(`Error deleting release artifact: ${artifact.id}, error: ${err}`));
    }

    await this.releaseRepo.delete({project: {id: params.projectId}, version: params.version});

    return "Release deleted"

  }
  
  async setReleaseArtifact(artifact: SetReleaseArtifactDto): Promise<SetReleaseArtifactResDto>{
    this.logger.log(`Adding release artifact for release: ${artifact.version}, artifactName: ${artifact.artifactName}`);
    const release = await this.releaseRepo.findOneBy({version: artifact.version, project: {id: artifact.projectId}});
    if (!release){
      this.logger.error(`Release not found for id: ${artifact.version}`);
      throw new NotFoundException(`Release not found for id: ${artifact.version}`);
    }

    const artifactEntity = new ReleaseArtifactEntity();
    artifactEntity.type = artifact.type;
    artifactEntity.artifactName = artifact.artifactName;
    artifactEntity.metadata = artifact.metadata;
    artifactEntity.release = release;
    artifactEntity.isInstallationFile = artifact.isInstallationFile;
    
    const res = new SetReleaseArtifactResDto();
    const upsertOptions: UpsertOptions<ReleaseArtifactEntity> = {conflictPaths: []};

    if (artifact.type === ArtifactTypeEnum.FILE){
      
      const uploadDto = {
        fileName: artifact.artifactName,
        objectKey: `${artifact.projectId}/${artifact.version}`,
        userId: 'release',
      } as CreateFileUploadUrlDto
      const upload =  await this.fileUploadService.createFileUploadUrl(uploadDto);
      artifactEntity.fileUpload = {id: upload.id} as unknown as FileUploadEntity;
      
      res.uploadUrl = upload.url;

      upsertOptions.conflictPaths = ['release', 'fileUpload'];
      upsertOptions.indexPredicate = "file_upload_id IS NOT NULL and type = 'file'"

    }else {
      artifactEntity.dockerImageUrl = artifact.dockerImageUrl;

      upsertOptions.conflictPaths = ['release', 'dockerImageUrl'];
      upsertOptions.indexPredicate = "docker_image_url IS NOT NULL AND type = 'docker_image'"
    }
    
    this.logger.debug(`Saving release artifact for release: ${artifact.version}, type: ${artifact.type}`);
    const saved = await this.artifactRepo.upsert(artifactEntity, upsertOptions);
    res.artifactId = saved.identifiers[0].id;
    
    return res;
  }

  async deleteReleaseArtifact(params: ReleaseArtifactParams): Promise<string>{
    this.logger.log(`Deleting release artifact of release: ${params.version}, artifact Id: ${params.artifactId}`);
    const artifact =  await this.artifactRepo.findOne({
        select: {fileUpload: {id: true}},
        where: {release: {project: {id: params.projectId}, version: params.version}, id: params.artifactId},
        relations: {fileUpload: true}
      });

    if (!artifact){
      throw new NotFoundException(`Release artifact not found for project: ${params.projectId} release: ${params.version}, artifact Id: ${params.artifactId}`);
    }

    if (artifact.type == ArtifactTypeEnum.FILE){
      await this.fileUploadService.deleteFile(artifact.id)
    }

    await this.artifactRepo.delete({id: params.artifactId})
    return "Release Artifact deleted"
  }

  private async onFileCreate(fileUpload: FileUploadEntity) {
    const release = await this.releaseRepo.findOne({
      select: {project: {id: true}},
      where: {artifacts: {fileUpload: {objectKey: fileUpload.objectKey}}},
      relations: {project: true}
    })
    if (release) {
      this.logger.debug(`onFileCreate: File is part of release: ${release.version}, of project: ${release.project.id}`);
      this.refreshReleaseState({projectId: release.project.id, version: release.version} as ReleaseParams);
    }
  }


  private async onFileDelete(fileUpload: FileUploadEntity) {
    const release = await this.releaseRepo.findOne({
      select: {project: {id: true}},
      where: {artifacts: {fileUpload: {objectKey: fileUpload.objectKey}}},
      relations: {project: true}
    })
    if (release) {
      this.logger.debug(`onFileDelete: File is part of release: ${release.version}, of project: ${release.project.id}`);
      this.refreshReleaseState({projectId: release.project.id, version: release.version} as ReleaseParams);
    }
  }

  async refreshReleaseState(params: ReleaseParams): Promise<void> {
    this.logger.log(`Refreshing release state for project: ${params.projectId}, version: ${params.version}`);

    const release = await this.getRelease(params).catch(null);
    if (!release) return;
    
    const installationArtifacts = release.artifacts.filter((artifact) => artifact?.isInstallationFile)
    const files = await this.fileUploadService.getFilesByIds(installationArtifacts.map((artifact) => artifact.uploadId));

    if (installationArtifacts.length === 0 
      || installationArtifacts.length > files.length
      || files.some((file) => file.status !== FileUPloadStatusEnum.UPLOADED)
    ){
      this.logger.warn(`Release ${params.version} for project: ${params.projectId} has no installation file or not all files are uploaded`);
      await this.releaseRepo.update({version: params.version, project: {id: params.projectId}, status: ReleaseStatusEnum.RELEASED}, {status: ReleaseStatusEnum.IN_REVIEW});
      return
    }
    
      const regulations = await this.regulationRepo.find({where: {project: {id: params.projectId}}});
      const statuses = await this.regulationService.getVersionRegulationsStatuses(params);

      let regulationsCompliant = true;

      for (const regulation of regulations) {
        const status = statuses.find((s) => s.regulation === regulation.name);
        if (!status || !status.isCompliant) {
          this.logger.warn(`Regulation ${regulation.name} for project: ${params.projectId}, version: ${params.version} is not compliant`);
          regulationsCompliant = false;
        }
      }
    
      if (regulationsCompliant && release.status === ReleaseStatusEnum.IN_REVIEW){
        this.logger.log(`Setting release status to released for project: ${params.projectId}, version: ${params.version}`);
        await this.releaseRepo.update({version: params.version, project: {id: params.projectId}}, {status: ReleaseStatusEnum.RELEASED});
      }else if (!regulationsCompliant && release.status === ReleaseStatusEnum.RELEASED){
        this.logger.log(`Setting release status to in_review for project: ${params.projectId}, version: ${params.version}`);
        await this.releaseRepo.update({version: params.version, project: {id: params.projectId}}, {status: ReleaseStatusEnum.IN_REVIEW});
      }

  }
}