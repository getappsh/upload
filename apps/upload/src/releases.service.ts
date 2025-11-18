import { ReleaseEntity, ReleaseArtifactEntity, ProjectEntity, ReleaseStatusEnum, ArtifactTypeEnum, FileUploadEntity, RegulationEntity, FileUPloadStatusEnum } from "@app/common/database/entities";
import { SetReleaseArtifactDto, SetReleaseArtifactResDto, CreateFileUploadUrlDto, SetReleaseDto, ReleaseParams, ReleaseDto, ReleaseArtifactParams, DetailedReleaseDto, ReleaseEventType, ReleaseEventEnum, ReleaseChangedEventDto, GetReleaseArtifactResDto, ReleaseArtifactNameParams, UpdateFileMetaDataDto } from "@app/common/dto/upload";
import { Inject, Injectable, Logger, NotFoundException, ConflictException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Not, Repository } from "typeorm";
import { FileUploadService } from "./file-upload.service";
import { UpsertOptions } from "typeorm/repository/UpsertOptions";
import { RegulationStatusService } from "./regulation-status.service";
import { MinimalReleaseDto, ProjectReleasesChangedEvent, RegulationChangedEvent, RegulationChangedEventType, RegulationParams } from "@app/common/dto/project-management";
import { MicroserviceClient, MicroserviceName } from "@app/common/microservice-client";
import { OfferingTopicsEmit, ProjectManagementTopicsEmit } from "@app/common/microservice-client/topics";
import { lastValueFrom } from "rxjs";


@Injectable()
export class ReleaseService {
  private readonly logger = new Logger(ReleaseService.name);

  constructor(
    @Inject(MicroserviceName.PROJECT_MANAGEMENT_SERVICE) private readonly projectClient: MicroserviceClient,
    @InjectRepository(ReleaseEntity) private readonly releaseRepo: Repository<ReleaseEntity>,
    @InjectRepository(ReleaseArtifactEntity) private readonly artifactRepo: Repository<ReleaseArtifactEntity>,
    @InjectRepository(RegulationEntity) private readonly regulationRepo: Repository<RegulationEntity>,
    @Inject(MicroserviceName.OFFERING_SERVICE) private readonly offeringClient: MicroserviceClient,
    private readonly fileUploadService: FileUploadService,
    private readonly regulationService: RegulationStatusService,
  ) {

    this.fileUploadService.onFileCreate(file => this.onFileCreate(file));
    this.fileUploadService.onFileDelete(file => this.onFileDelete(file));
  }

  async setRelease(dto: SetReleaseDto): Promise<ReleaseDto> {
    this.logger.log(`Setting release for project: ${dto.projectId}, version: ${dto.version}`);

    const releaseEntity = await this.releaseRepo.findOneBy({ project: { id: dto.projectId }, version: dto.version }) ?? this.releaseRepo.create();

    releaseEntity.project = { id: dto.projectId } as unknown as ProjectEntity;
    releaseEntity.version = dto.version;
    releaseEntity.name = dto?.name;
    releaseEntity.releaseNotes = dto?.releaseNotes;;
    releaseEntity.metadata = dto?.metadata;
    if (dto?.isDraft === true) {
      releaseEntity.status = ReleaseStatusEnum.DRAFT
    } else if (dto?.isDraft === false) {
      releaseEntity.status = ReleaseStatusEnum.IN_REVIEW
    }
    releaseEntity.requiredRegulationsCount = await this.regulationRepo.count({ where: { project: { id: dto.projectId } } })

    if (dto.dependencies) {
      releaseEntity.dependencies = await this.getAndValidateDependenciesForRelease(dto, dto.dependencies);
    }

    this.logger.debug(`Saving release: ${JSON.stringify(releaseEntity)}`);
    await this.releaseRepo.save(releaseEntity)

    await this.refreshReleaseState(dto);

    return this.getRelease(dto);
  }

  private async getAndValidateDependenciesForRelease(release: { projectId: number, version: string }, dependencies: string[]): Promise<ReleaseEntity[]> {
    const dependencyEntities = await this.releaseRepo.find({
      where: { catalogId: In(dependencies) },
      relations: ['project'],
      select: { catalogId: true, version: true, project: { id: true } },
    });

    if (dependencies.length > dependencyEntities.length) {
      throw new NotFoundException('Some dependencies do not exist');
    }

    const conflictedDependencies = dependencyEntities.filter(dep => dep.project.id === release.projectId).map(dep => dep.version);

    if (conflictedDependencies.length > 0) {
      throw new ConflictException(`Release ${release.version} cannot depend on a release (${conflictedDependencies.join(', ')}) from the same project.`);
    }
    return dependencyEntities
  }

  async getRelease(params: ReleaseParams): Promise<DetailedReleaseDto> {
    this.logger.log(`Getting release for project: ${params.projectIdentifier}, version: ${params.version}`);
    if (typeof params.projectIdentifier !== 'number') {
      const project = await this.releaseRepo.manager.getRepository(ProjectEntity).findOneBy({ name: params.projectIdentifier });
      if (!project) {
        throw new NotFoundException(`Project not found: ${params.projectIdentifier}`);
      }
      params.projectId = project.id;
    }
    return this.getReleaseEntity(params).then((release) => {
      if (!release) {
        throw new NotFoundException(`Release not found for project: ${params.projectId}, version: ${params.version}`);
      }
      return DetailedReleaseDto.fromEntity(release);
    })
  }

  private async getReleaseEntity(params: { projectId: number, version: string }): Promise<ReleaseEntity> {
    return await this.releaseRepo.findOne({
      select: { project: { id: true, name: true }, dependentReleases: { version: true, project: { id: true, name: true } } },
      where: {
        project: { id: params.projectId },
        version: params.version
      },
      relations: {
        artifacts: { fileUpload: true },
        dependencies: { project: true },
        dependentReleases: { project: true },
        project: true
      }
    })
  }

  async getReleases(projectIdentifier: number | string): Promise<ReleaseDto[]> {
    this.logger.log(`Getting releases for project: ${projectIdentifier}`);

     const projectCondition = typeof projectIdentifier === 'number'
    ? { id: projectIdentifier }
    : { name: projectIdentifier };

    const releases = await this.releaseRepo.find({
      where: {
        project: projectCondition
      },
      order: { sortOrder: 'DESC' },
      relations: ['project'],
      select: { project: { id: true, name: true } }
    })
    return releases.map((release) => ReleaseDto.fromEntity(release));
  }


  async deleteRelease(params: ReleaseParams): Promise<string> {
    this.logger.log(`Deleting release of project: ${params.projectId}, version: ${params.version}`);
    const release = await this.getRelease(params);

    const regulationStatuses = await this.regulationService.getVersionRegulationsStatuses(params);
    for (const regulationStatus of regulationStatuses) {
      await this.regulationService.deleteVersionRegulationStatus({ regulation: regulationStatus.regulation, ...params })
        .catch(err => this.logger.error(`Error deleting regulation status: ${regulationStatus.regulation}, error: ${err}`));
    }

    for (const artifact of release.artifacts) {
      await this.deleteReleaseArtifact({ artifactId: artifact.id, ...params })
        .catch(err => this.logger.error(`Error deleting release artifact: ${artifact.id}, error: ${err}`));
    }

    await this.releaseRepo.delete({ project: { id: params.projectId }, version: params.version });

    this.sendProjectReleasesChangedEvent(params.projectId, release.id, ReleaseEventEnum.DELETED);

    return "Release deleted"

  }

  async  updateLatestForProject(projectId: number) {
    await this.releaseRepo
        .createQueryBuilder()
        .update(ReleaseEntity)
        .set({
            latest: () => `
                CASE 
                    WHEN catalog_id = (
                        SELECT catalog_id 
                        FROM "release"
                        WHERE project_id = :projectId AND status = :status
                        ORDER BY sort_order DESC
                        LIMIT 1
                    ) 
                    THEN TRUE 
                    ELSE FALSE 
                END
            `,
        })
        .where("project_id = :projectId", { projectId, status: ReleaseStatusEnum.RELEASED })
        .execute();
}

  async setReleaseArtifact(artifact: SetReleaseArtifactDto): Promise<SetReleaseArtifactResDto> {
    this.logger.log(`Adding release artifact for release: ${artifact.version}, artifactName: ${artifact.artifactName}`);
    const release = await this.releaseRepo.findOneBy({ version: artifact.version, project: { id: artifact.projectId } });
    if (!release) {
      this.logger.error(`Release not found for id: ${artifact.version}`);
      throw new NotFoundException(`Release not found for id: ${artifact.version}`);
    }

    const artifactEntity = new ReleaseArtifactEntity();
    artifactEntity.type = artifact.type;
    artifactEntity.artifactName = artifact.artifactName;
    artifactEntity.metadata = artifact.metadata;
    artifactEntity.release = release;
    artifactEntity.isInstallationFile = artifact.isInstallationFile;
    artifactEntity.arguments = artifact.arguments;
    artifactEntity.isExecutable = artifact.isExecutable;
    
    const res = new SetReleaseArtifactResDto();
    const upsertOptions: UpsertOptions<ReleaseArtifactEntity> = { conflictPaths: [] };

    if (artifact.type === ArtifactTypeEnum.FILE) {

      const uploadDto = {
        fileName: artifact.artifactName,
        objectKey: `${artifact.projectId}/${artifact.version}`,
        userId: 'release',
      } as CreateFileUploadUrlDto
      const upload = await this.fileUploadService.createFileUploadUrl(uploadDto);
      artifactEntity.fileUpload = { id: upload.id } as unknown as FileUploadEntity;

      res.uploadUrl = upload.url;

      upsertOptions.conflictPaths = ['release', 'fileUpload'];
      upsertOptions.indexPredicate = "file_upload_id IS NOT NULL and type = 'file'"

    } else {
      artifactEntity.dockerImageUrl = artifact.dockerImageUrl;

      upsertOptions.conflictPaths = ['release', 'dockerImageUrl'];
      upsertOptions.indexPredicate = "docker_image_url IS NOT NULL AND type = 'docker_image'"
    }

    this.logger.debug(`Saving release artifact for release: ${artifact.version}, type: ${artifact.type}`);
    const saved = await this.artifactRepo.upsert(artifactEntity, upsertOptions);
    res.artifactId = saved.identifiers[0].id;

    if (artifact.type === ArtifactTypeEnum.DOCKER_IMAGE) {
      this.refreshReleaseState(artifact)
    }

    return res;
  }

  async deleteReleaseArtifact(params: ReleaseArtifactParams): Promise<string> {
    this.logger.log(`Deleting release artifact of release: ${params.version}, artifact Id: ${params.artifactId}`);
    const artifact = await this.artifactRepo.findOne({
      select: { fileUpload: { id: true } },
      where: { release: { project: { id: params.projectId }, version: params.version }, id: params.artifactId },
      relations: { fileUpload: true }
    });

    if (!artifact) {
      throw new NotFoundException(`Release artifact not found for project: ${params.projectId} release: ${params.version}, artifact Id: ${params.artifactId}`);
    }

    if (artifact.type == ArtifactTypeEnum.FILE) {
      await this.fileUploadService.removeFile(artifact.fileUpload.id);
      await this.artifactRepo.delete({ id: params.artifactId })
      this.fileUploadService.deleteItemRow(artifact.fileUpload.id)
        .catch(err => this.logger.error(`Error deleting file upload row from the db: ${artifact.fileUpload.id}, error: ${err}`));
    }else {
      await this.artifactRepo.delete({ id: params.artifactId })
    }

    return "Release Artifact deleted"
  }

  async getArtifactDownloadUrl(params: ReleaseArtifactNameParams) {
    this.logger.log(`Getting artifact download url for project: ${params.projectId}, version: ${params.version}, fileName: ${params.fileName}`);
    const artifact = await this.artifactRepo.findOne({
      select: { fileUpload: { id: true } },
      where: { release: { project: { id: params.projectId }, version: params.version }, artifactName: params.fileName },
      relations: { fileUpload: true }
    });

    if (!artifact) {
      throw new NotFoundException(`Release artifact not found for project: ${params.projectId} release: ${params.version}, artifact Name: ${params.fileName}`);
    }

    const downloadUrl = await this.fileUploadService.getFileDownloadUrl(artifact.fileUpload.id);
    const res = new GetReleaseArtifactResDto();
    res.downloadUrl = downloadUrl;
    res.artifactId = artifact.id;
    this.logger.debug(`Release artifact download url: ${downloadUrl}, artifact Id: ${artifact.id}`);
  
    return res
  }

  private async onFileCreate(fileUpload: FileUploadEntity) {
    const release = await this.releaseRepo.findOne({
      select: { project: { id: true } },
      where: { artifacts: { fileUpload: { objectKey: fileUpload.objectKey } } },
      relations: { project: true }
    })
    if (release) {
      this.logger.debug(`onFileCreate: File is part of release: ${release.version}, of project: ${release.project.id}`);
      this.refreshReleaseState({ projectId: release.project.id, version: release.version } as ReleaseParams);
    }
  }


  private async onFileDelete(fileUpload: FileUploadEntity) {
    const release = await this.releaseRepo.findOne({
      select: { project: { id: true } },
      where: { artifacts: { fileUpload: { objectKey: fileUpload.objectKey } } },
      relations: { project: true }
    })
    if (release) {
      this.logger.debug(`onFileDelete: File is part of release: ${release.version}, of project: ${release.project.id}`);
      this.refreshReleaseState({ projectId: release.project.id, version: release.version } as ReleaseParams);
    }
  }

  async onProjectRegulationChanged(event: RegulationChangedEvent) {
    switch (event.type) {
      case RegulationChangedEventType.CREATED:
        await this.onProjectRegulationCreated(event);
        break;
      case RegulationChangedEventType.UPDATED:
        break;
      case RegulationChangedEventType.DELETED:
        await this.onProjectRegulationDeleted(event);
        break;

    }
  }
  private async onProjectRegulationDeleted(event: RegulationChangedEvent) {
    this.logger.debug(`onProjectRegulationDeleted: Project: ${event.projectId}, Regulation: ${event.regulation}`);
    const releases = await this.releaseRepo.find({
      where: {
        project: { id: event.projectId },
        status: In([ReleaseStatusEnum.DRAFT, ReleaseStatusEnum.IN_REVIEW])
      }
    })

    for (const release of releases) {
      this.logger.debug(`Delete if exist regulation status for Project: ${event.projectId}, Regulation: ${event.regulation}, Version: ${release.version}`);
      await this.regulationService.deleteVersionRegulationStatus({ version: release.version, projectIdentifier: event.projectId, ...event }).catch(() => { });
      await this.regulationService.deleteOrphanRegulationStatuses({ version: release.version, projectId: event.projectId, projectIdentifier: event.projectId }).catch(() => { });
      await this.refreshReleaseState({ version: release.version, projectIdentifier: event.projectId, ...event });
    }
  }

  private async onProjectRegulationCreated(event: RegulationChangedEvent) {
    this.logger.debug(`onProjectRegulationCreated: Project: ${event.projectId}, Regulation: ${event.regulation}`);
    const releases = await this.releaseRepo.find({
      where: {
        project: { id: event.projectId },
        status: In([ReleaseStatusEnum.DRAFT, ReleaseStatusEnum.IN_REVIEW])
      }
    })

    for (const release of releases) {
      await this.refreshReleaseState({ version: release.version, projectIdentifier: event.projectId, ...event });
    }
  }

  private async getLatestAndUpcomingReleases(projectId: number): Promise<ProjectReleasesChangedEvent> {
    this.logger.debug(`Get latest and upcoming releases for project: ${projectId}`);

    const changedEvent = new ProjectReleasesChangedEvent()
    changedEvent.projectId = projectId;

    const releases = await this.getReleases(projectId);

    for (const release of releases) {
      if ((release.status === ReleaseStatusEnum.DRAFT || release.status === ReleaseStatusEnum.IN_REVIEW) && !changedEvent.upcomingRelease) {
        changedEvent.upcomingRelease = MinimalReleaseDto.fromReleaseDto(release);

      } else if (release.status === ReleaseStatusEnum.RELEASED) {
        changedEvent.latestRelease = MinimalReleaseDto.fromReleaseDto(release);
        break;
      }
    }
    return changedEvent
  }

  private async sendProjectReleasesChangedEvent(projectId: number, catalogId: string, event?: ReleaseEventType) {
    this.logger.log(`Sending project releases changed event for project: ${projectId}`);
    const latestAndPending = await this.getLatestAndUpcomingReleases(projectId);
    lastValueFrom(this.projectClient.emit(ProjectManagementTopicsEmit.PROJECT_RELEASES_CHANGED, latestAndPending))
      .catch(err => this.logger.error(`Failed to send project releases changed event for project: ${projectId}, error: ${err}`));

    if (event) {
      const eventDto = new ReleaseChangedEventDto(catalogId, event);
      lastValueFrom(this.offeringClient.emit(OfferingTopicsEmit.RELEASE_CHANGED_EVENT, eventDto))
        .catch(err => this.logger.error(`Failed to send release event for project: ${projectId}, error: ${err}`));
    }
  }

  // TODO write unit-test
  async refreshReleaseState(params: ReleaseParams): Promise<void> {
    this.logger.log(`Refreshing release state for project: ${params.projectId}, version: ${params.version}`);

    const release = await this.getReleaseEntity(params).catch(() => { });
    if (!release) return;

    const regulations = await this.regulationRepo.find({ where: { project: { id: params.projectId } } });
    const statuses = await this.regulationService.getVersionRegulationsStatuses(params);

    let regulationsCompliant = true;
    let numCompliant = 0;
    for (const regulation of regulations) {
      const status = statuses.find((s) => s.regulation === regulation.name);
      if (!status || !status.isCompliant) {
        this.logger.verbose(`Regulation ${regulation.name} for project: ${params.projectId}, version: ${params.version} is not compliant`);
        regulationsCompliant = false;
      } else {
        numCompliant++;
      }
    }

    this.logger.log(`Release: ${params.version} for project: ${params.projectId} has ${numCompliant} out of ${regulations.length} regulations compliant`);

    await this.releaseRepo.update({
      version: params.version,
      project: { id: params.projectId },
      status: Not(ReleaseStatusEnum.RELEASED)
      },
      {
        requiredRegulationsCount: regulations.length,
        compliantRegulationsCount: numCompliant
      });

    
    let changeStatus = null;

    const dependenciesReleased = release?.dependencies?.length > 0 && release?.dependencies?.every(dep => dep.status === ReleaseStatusEnum.RELEASED);

    this.logger.log(`Release: ${params.version} for project: ${params.projectId} dependencies released: ${dependenciesReleased} (if exists)`);

    const installationArtifacts = release.artifacts.filter((artifact) => artifact?.isInstallationFile);
    const fileUploaded = installationArtifacts?.length > 0 && await this.fileUploadService
      .areFilesUploaded(
        installationArtifacts
          .filter((artifact) =>  artifact?.type === ArtifactTypeEnum.FILE)
          .map((artifact) => artifact?.fileUpload?.id)
      );

    this.logger.log(`Release: ${params.version} for project: ${params.projectId} has ${installationArtifacts.length} installation files and they are ready: ${fileUploaded}`);
    
    this.logger.debug(`Release: ${params.version} for project: ${params.projectId}, status: ${release.status}, regulationsCompliant: ${regulationsCompliant}, dependenciesReleased: ${dependenciesReleased}, fileUploaded: ${fileUploaded}`);
   
    if ((!regulationsCompliant || (!dependenciesReleased && !fileUploaded)) && release.status === ReleaseStatusEnum.RELEASED) {
      this.logger.log(`Setting release status to in_review for project: ${params.projectId}, version: ${params.version}`);
      const res = await this.releaseRepo.update({ version: params.version, project: { id: params.projectId } }, { status: ReleaseStatusEnum.IN_REVIEW, releasedAt: null});
      if (res.affected > 0) {
        this.updateLatestForProject(params.projectId);
        release?.dependentReleases?.forEach(dep => {
          this.logger.verbose(`Refreshing dependent release state, project: ${dep.project.id}, version: ${dep.version}`);
          this.refreshReleaseState({ version: dep.version, projectIdentifier: dep.project.id, projectId: dep.project.id })
        });

        changeStatus = ReleaseStatusEnum.IN_REVIEW
      }

    } else if (regulationsCompliant && release.status === ReleaseStatusEnum.IN_REVIEW && (dependenciesReleased || fileUploaded)) {
      this.logger.log(`Setting release status to released for project: ${params.projectId}, version: ${params.version}`);
      // const res = await this.releaseRepo.update({ version: params.version, project: { id: params.projectId } }, { status: ReleaseStatusEnum.RELEASED});
      const res = await this.releaseRepo.createQueryBuilder()
        .update()
        .set({ 
          status: ReleaseStatusEnum.RELEASED,
          releasedAt: () => `CASE WHEN released_at IS NULL THEN NOW() ELSE released_at END`
        })
        .where("version = :version AND project_id = :projectId", { 
          version: params.version, 
          projectId: params.projectId 
        })
        .execute();
        
      if (res.affected > 0) {
        this.updateLatestForProject(params.projectId);
        release?.dependentReleases?.forEach(dep => {
          this.logger.verbose(`Refreshing dependent release state, project: ${dep.project.id}, version: ${dep.version}`);
          this.refreshReleaseState({ version: dep.version, projectIdentifier: dep.project.id, projectId: dep.project.id })
        });

        changeStatus = ReleaseStatusEnum.RELEASED
      }
      
    }

    this.sendProjectReleasesChangedEvent(params.projectId, release.catalogId, changeStatus);
  }
  async updateFileMetadata(dto: UpdateFileMetaDataDto) {
    
    const affectedRows = await this.artifactRepo.update(
      { id: dto.id },
        {
          isExecutable: dto.isExecutable,
          isInstallationFile: dto.isInstallationFile,
          arguments: dto.arguments,
          metadata: dto.metadata
        }
      );
      return affectedRows.affected;
    }
}