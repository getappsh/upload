import { ReleaseEntity, ReleaseArtifactEntity, ProjectEntity, ReleaseStatusEnum, ArtifactTypeEnum, FileUploadEntity, RegulationEntity, FileUPloadStatusEnum, RuleEntity, RuleReleaseEntity, DeliveryStatusEntity, DeployStatusEntity, DeliveryStatusEnum, DeployStatusEnum } from "@app/common/database/entities";
import { SetReleaseArtifactDto, SetReleaseArtifactResDto, CreateFileUploadUrlDto, SetReleaseDto, ReleaseParams, ReleaseDto, ReleaseArtifactParams, DetailedReleaseDto, ReleaseEventType, ReleaseEventEnum, ReleaseChangedEventDto, GetReleaseArtifactResDto, ReleaseArtifactNameParams, UpdateFilePropertiesDto, DeploymentReportDto, DeviceDeploymentDetailDto } from "@app/common/dto/upload";
import { AppError, ErrorCode } from "@app/common/dto/error";
import { Inject, Injectable, Logger, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Not, Repository } from "typeorm";
import { FileUploadService } from "./file-upload.service";
import { UpsertOptions } from "typeorm/repository/UpsertOptions";
import { RegulationStatusService } from "./regulation-status.service";
import { MinimalReleaseDto, ProjectReleasesChangedEvent, RegulationChangedEvent, RegulationChangedEventType, RegulationParams } from "@app/common/dto/project-management";
import { MicroserviceClient, MicroserviceName } from "@app/common/microservice-client";
import { OfferingTopicsEmit, ProjectManagementTopicsEmit, OfferingTopics, DeliveryTopics, DeployTopics } from "@app/common/microservice-client/topics";
import { lastValueFrom } from "rxjs";
import { ExportReleaseDto, ExportArtifactDto, ExportDockerImageDto, ExportDependencyDto, ImportReleaseDto, ImportReleaseResponseDto, ArtifactWarningDto } from "@app/common/dto/delivery";
import { MinioClientService } from "@app/common/AWS/minio-client.service";
import { ConfigService } from "@nestjs/config";
import { ClsService } from 'nestjs-cls';
import { ApiRole, PermissionsService } from "@app/common";


@Injectable()
export class ReleaseService {
  private readonly logger = new Logger(ReleaseService.name);
  private readonly DEFAULT_RULE_ID = '00000000-0000-0000-0000-000000000001';

  constructor(
    @Inject(MicroserviceName.PROJECT_MANAGEMENT_SERVICE) private readonly projectClient: MicroserviceClient,
    @InjectRepository(ReleaseEntity) private readonly releaseRepo: Repository<ReleaseEntity>,
    @InjectRepository(ReleaseArtifactEntity) private readonly artifactRepo: Repository<ReleaseArtifactEntity>,
    @InjectRepository(RegulationEntity) private readonly regulationRepo: Repository<RegulationEntity>,
    @InjectRepository(RuleEntity) private readonly ruleRepo: Repository<RuleEntity>,
    @InjectRepository(RuleReleaseEntity) private readonly ruleReleaseRepo: Repository<RuleReleaseEntity>,
    @Inject(MicroserviceName.DELIVERY_SERVICE) private readonly deliveryClient: MicroserviceClient,
    @Inject(MicroserviceName.DEPLOY_SERVICE) private readonly deployClient: MicroserviceClient,
    @Inject(MicroserviceName.OFFERING_SERVICE) private readonly offeringClient: MicroserviceClient,
    private readonly fileUploadService: FileUploadService,
    private readonly regulationService: RegulationStatusService,
    private readonly minioClient: MinioClientService,
    private readonly configService: ConfigService,
    private readonly cls: ClsService,
    private readonly permissionsService: PermissionsService,
  ) {

    this.fileUploadService.onFileCreate(file => this.onFileCreate(file));
    this.fileUploadService.onFileDelete(file => this.onFileDelete(file));
  }

  /**
   * Check if user has permission to edit an imported release that is in released status
   */
  private checkReadonlyReleasePermission(release: ReleaseEntity): void {
    // If release is imported and in released status, it's readonly
    if (release.isImported && release.status === ReleaseStatusEnum.RELEASED) {
      const user = this.cls.get('user');
      
      // Use PermissionsService to check for the special edit-imported-release role
      const hasPermission = this.permissionsService.hasRole(user, ApiRole.EDIT_IMPORTED_RELEASE);
      
      if (!hasPermission) {
        const username = user?.preferred_username || user?.email || 'unknown';
        this.logger.warn(
          `User ${username} attempted to modify readonly imported release ` +
          `(project: ${release.project?.id || 'unknown'}, version: ${release.version})`
        );
        throw new ForbiddenException(
          'This is an imported release in released status and is read-only. ' +
          'You need the "edit-imported-release" permission to modify it.'
        );
      }
      
      this.logger.log(`User ${user?.preferred_username} has permission to edit readonly imported release`);
    }
  }

  async setRelease(dto: SetReleaseDto, userEmail?: string): Promise<ReleaseDto> {
    this.logger.log(`Setting release for project: ${dto.projectId}, version: ${dto.version}`);

    const releaseEntity = await this.releaseRepo.findOneBy({ project: { id: dto.projectId }, version: dto.version }) ?? this.releaseRepo.create();
    
    const isNewRelease = !releaseEntity.catalogId;

    // Check permission if trying to update an existing readonly imported release
    if (!isNewRelease) {
      this.checkReadonlyReleasePermission(releaseEntity);
    }

    releaseEntity.project = { id: dto.projectId } as unknown as ProjectEntity;
    releaseEntity.version = dto.version;
    releaseEntity.name = dto?.name;
    releaseEntity.releaseNotes = dto?.releaseNotes;;
    const normalizedMetadata = dto?.metadata ? { ...dto.metadata } : undefined;
    if (normalizedMetadata && normalizedMetadata.installationSize !== undefined) {
      const parsedInstallationSize = Number(normalizedMetadata.installationSize);
      normalizedMetadata.installationSize = Number.isFinite(parsedInstallationSize)
        ? parsedInstallationSize
        : 0;
    }
    releaseEntity.metadata = normalizedMetadata;
    if (dto?.isDraft === true) {
      releaseEntity.status = ReleaseStatusEnum.DRAFT
    } else if (dto?.isDraft === false) {
      releaseEntity.status = ReleaseStatusEnum.IN_REVIEW
    }
    releaseEntity.requiredRegulationsCount = await this.regulationRepo.count({ where: { project: { id: dto.projectId } } })

    // Set createdBy for new releases, updatedBy for all releases
    if (userEmail) {
      if (isNewRelease) {
        releaseEntity.createdBy = userEmail;
      }
      releaseEntity.updatedBy = userEmail;
    }

    if (dto.dependencies) {
      releaseEntity.dependencies = await this.getAndValidateDependenciesForRelease(dto, dto.dependencies);
    }

    this.logger.debug(`Saving release: ${JSON.stringify(releaseEntity)}`);
    await this.releaseRepo.save(releaseEntity)

    // Link default rule to new releases
    if (isNewRelease) {
      await this.linkDefaultRuleToRelease(releaseEntity.catalogId);
    }
    // Calculate and update totalSize after saving
    await this.updateTotalSize(dto.projectId, dto.version);

    await this.refreshReleaseState(dto);

    return this.getRelease(dto);
  }

  /**
   * Links the default "Allow All Devices" rule to a release if it exists and isn't already linked
   */
  private async linkDefaultRuleToRelease(releaseCatalogId: string): Promise<void> {
    try {
      // Check if default rule exists and is active
      const defaultRule = await this.ruleRepo.findOne({
        where: { id: this.DEFAULT_RULE_ID, isActive: true }
      });

      if (!defaultRule) {
        this.logger.warn(`Default rule ${this.DEFAULT_RULE_ID} not found or is inactive`);
        return;
      }

      // Check if link already exists
      const existingLink = await this.ruleReleaseRepo.findOne({
        where: {
          rule: { id: this.DEFAULT_RULE_ID },
          release: { catalogId: releaseCatalogId }
        }
      });

      if (existingLink) {
        this.logger.debug(`Default rule already linked to release ${releaseCatalogId}`);
        return;
      }

      // Create the link
      const ruleRelease = this.ruleReleaseRepo.create({
        rule: { id: this.DEFAULT_RULE_ID } as RuleEntity,
        release: { catalogId: releaseCatalogId } as ReleaseEntity
      });

      await this.ruleReleaseRepo.save(ruleRelease);
      this.logger.log(`Linked default rule to release ${releaseCatalogId}`);
    } catch (error) {
      this.logger.error(`Failed to link default rule to release ${releaseCatalogId}: ${error.message}`);
      // Don't throw - this shouldn't block release creation
    }
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

    const conflictedDependencies = dependencyEntities.filter(dep => dep.project.id === release.projectId && dep.version === release.version).map(dep => dep.version);

    if (conflictedDependencies.length > 0) {
      throw new ConflictException(`Release ${release.version} cannot depend on itself.`);
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
      const user = this.cls.get('user');
      const userCanEditImported = user ? this.permissionsService.hasRole(user, ApiRole.EDIT_IMPORTED_RELEASE) : false;
      return DetailedReleaseDto.fromEntity(release, userCanEditImported);
    })
  }

  private async getReleaseEntity(params: { projectId: number, version: string }): Promise<ReleaseEntity> {
    return await this.releaseRepo.findOne({
      select: { project: { id: true, name: true }, dependentReleases: { name: true, version: true, project: { id: true, name: true } } },
      where: {
        project: { id: params.projectId },
        version: params.version
      },
      relations: {
        artifacts: { fileUpload: true },
        dependencies: { project: true },
        dependentReleases: { project: true },
        project: true,
        policyAssociations: { rule: true }
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
    const user = this.cls.get('user');
    const userCanEditImported = user ? this.permissionsService.hasRole(user, ApiRole.EDIT_IMPORTED_RELEASE) : false;
    return releases.map((release) => ReleaseDto.fromEntity(release, userCanEditImported));
  }


  async deleteRelease(params: ReleaseParams): Promise<string> {
    this.logger.log(`Deleting release of project: ${params.projectId}, version: ${params.version}`);
    const release = await this.getRelease(params);

    // Get the full release entity with dependentReleases to check if any releases depend on it
    const releaseEntity = await this.getReleaseEntity(params);

    // Check if there are releases that depend on this release
    if (releaseEntity.dependentReleases && releaseEntity.dependentReleases.length > 0) {
      const dependentReleasesList = releaseEntity.dependentReleases.map(dep => ({
        projectName: dep.project.name,
        releaseName: dep.name || dep.version,
        version: dep.version
      }));

      throw new AppError(
        ErrorCode.RELEASE_HAS_DEPENDENTS,
        `Cannot delete release because other releases depend on it.`,
        400,
        { dependentReleases: dependentReleasesList }
      );
    }

    const regulationStatuses = await this.regulationService.getVersionRegulationsStatuses(params);
    for (const regulationStatus of regulationStatuses) {
      await this.regulationService.deleteVersionRegulationStatus({ regulation: regulationStatus.regulation, ...params })
        .catch(err => this.logger.error(`Error deleting regulation status: ${regulationStatus.regulation}, error: ${err}`));
    }

    for (const artifact of release.artifacts) {
      await this.deleteReleaseArtifact({ artifactId: artifact.id, ...params }, true)
        .catch(err => this.logger.error(`Error deleting release artifact: ${artifact.id}, error: ${err}`));
    }

    await this.releaseRepo.delete({ project: { id: params.projectId }, version: params.version });

    this.sendProjectReleasesChangedEvent(params.projectId, release.id, ReleaseEventEnum.DELETED);

    return "Release deleted"

  }

  async updateLatestForProject(projectId: number) {
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

    // Check permission for readonly imported releases
    this.checkReadonlyReleasePermission(release);

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
        // TODO consider adding version id to object key to avoid overwriting same version of other branches
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

    // Calculate and update totalSize after adding/updating artifact
    await this.updateTotalSize(artifact.projectId, artifact.version);

    if (artifact.type === ArtifactTypeEnum.DOCKER_IMAGE) {
      this.refreshReleaseState(artifact)
    }

    return res;
  }

    async deleteReleaseArtifact(params: ReleaseArtifactParams, skipPermissionCheck: boolean = false): Promise<string> {
    this.logger.log(`Deleting release artifact of release: ${params.version}, artifact Id: ${params.artifactId}`);
    const artifact = await this.artifactRepo.findOne({
      select: { fileUpload: { id: true }, release: { isImported: true, status: true } },
      where: { release: { project: { id: params.projectId }, version: params.version }, id: params.artifactId },
      relations: { fileUpload: true, release: true }
    });

    if (!artifact) {
      throw new NotFoundException(`Release artifact not found for project: ${params.projectId} release: ${params.version}, artifact Id: ${params.artifactId}`);
    }

    // Check permission for readonly imported releases (unless skipped for release deletion)
    if (!skipPermissionCheck) {
      this.checkReadonlyReleasePermission(artifact.release);
    }

    if (artifact.type == ArtifactTypeEnum.FILE) {
      await this.fileUploadService.removeFile(artifact.fileUpload.id);
      await this.artifactRepo.delete({ id: params.artifactId })
      this.fileUploadService.deleteItemRow(artifact.fileUpload.id)
        .catch(err => this.logger.error(`Error deleting file upload row from the db: ${artifact.fileUpload.id}, error: ${err}`));
    } else {
      // For docker images, handle file upload if exists, then delete the artifact
      if (artifact.fileUpload) {
        await this.onFileDelete(artifact.fileUpload);
      }
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
      await this.updateTotalSize(release.project.id, release.version);
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
      await this.updateTotalSize(release.project.id, release.version);
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
          .filter((artifact) => artifact?.type === ArtifactTypeEnum.FILE)
          .map((artifact) => artifact?.fileUpload?.id)
      );

    this.logger.log(`Release: ${params.version} for project: ${params.projectId} has ${installationArtifacts.length} installation files and they are ready: ${fileUploaded}`);

    this.logger.debug(`Release: ${params.version} for project: ${params.projectId}, status: ${release.status}, regulationsCompliant: ${regulationsCompliant}, dependenciesReleased: ${dependenciesReleased}, fileUploaded: ${fileUploaded}`);

    if ((!regulationsCompliant || (!dependenciesReleased && !fileUploaded)) && release.status === ReleaseStatusEnum.RELEASED) {
      this.logger.log(`Setting release status to in_review for project: ${params.projectId}, version: ${params.version}`);
      const res = await this.releaseRepo.update({ version: params.version, project: { id: params.projectId } }, { status: ReleaseStatusEnum.IN_REVIEW, releasedAt: null });
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
  async updateFileMetadata(dto: UpdateFilePropertiesDto) {
    // First fetch the artifact with its release to check permissions
    const artifact = await this.artifactRepo.findOne({
      select: { id: true, release: { isImported: true, status: true, version: true, project: { id: true } } },
      where: { id: dto.id },
      relations: { release: { project: true } }
    });

    if (!artifact) {
      throw new NotFoundException(`Artifact not found with id: ${dto.id}`);
    }

    // Check permission for readonly imported releases
    this.checkReadonlyReleasePermission(artifact.release);

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

  async exportRelease(params: ReleaseParams): Promise<ExportReleaseDto> {
    this.logger.log(`Exporting release for project: ${params.projectIdentifier}, version: ${params.version}`);
    
    if (typeof params.projectIdentifier !== 'number') {
      const project = await this.releaseRepo.manager.getRepository(ProjectEntity).findOneBy({ name: params.projectIdentifier });
      if (!project) {
        throw new NotFoundException(`Project not found: ${params.projectIdentifier}`);
      }
      params.projectId = project.id;
    }

    const release = await this.getReleaseEntity(params);
    if (!release) {
      throw new NotFoundException(`Release not found for project: ${params.projectId}, version: ${params.version}`);
    }

    const bucketName = this.configService.get('BUCKET_NAME');
    const exportDto = new ExportReleaseDto();
    exportDto.name = release.name || '';
    exportDto.version = release.version;
    exportDto.tag = `v${release.version}`;
    exportDto.createdAt = release.createdAt.toISOString();
    exportDto.project = release.project.name;
    exportDto.status = release.status;
    exportDto.releaseNotes = release.releaseNotes || '';
    exportDto.author = release.createdBy || 'unknown@example.com';
    exportDto.metadata = release.metadata || {};

    // Export artifacts
    exportDto.artifacts = [];
    exportDto.dockerImages = [];

    for (const artifact of release.artifacts || []) {
      if (artifact.type === ArtifactTypeEnum.FILE && artifact.fileUpload) {
        const artifactDto = new ExportArtifactDto();
        artifactDto.name = artifact.fileUpload.fileName;
        artifactDto.size = artifact.fileUpload.size || 0;
        
        // Use sha256 from file_upload, calculate from bucket if missing
        if (artifact.fileUpload.sha256) {
          artifactDto.sha256 = artifact.fileUpload.sha256;
        } else {
          this.logger.warn(`SHA256 missing for artifact ${artifact.fileUpload.fileName}, calculating from bucket`);
          try {
            artifactDto.sha256 = await this.fileUploadService.calculateSha256FromBucket(bucketName, artifact.fileUpload.objectKey);
            // Save it to file_upload table for future use
            await this.fileUploadService['uploadRepo'].update(
              { id: artifact.fileUpload.id },
              { sha256: artifactDto.sha256 }
            );
          } catch (error) {
            this.logger.error(`Failed to calculate SHA256 for ${artifact.fileUpload.fileName}: ${error.message}`);
            artifactDto.sha256 = '';
          }
        }
        
        artifactDto.downloadUrl = await this.minioClient.generatePresignedDownloadUrl(bucketName, artifact.fileUpload.objectKey);
        artifactDto.metadata = artifact.metadata || {};
        exportDto.artifacts.push(artifactDto);
      } else if (artifact.type === ArtifactTypeEnum.DOCKER_IMAGE) {
        const dockerDto = new ExportDockerImageDto();
        dockerDto.name = artifact.artifactName;
        dockerDto.imageUrl = artifact.dockerImageUrl;
        dockerDto.metadata = artifact.metadata || {};
        exportDto.dockerImages.push(dockerDto);
      }
    }

    // Export dependencies
    exportDto.dependencies = [];
    for (const dependency of release.dependencies || []) {
      const depDto = new ExportDependencyDto();
      depDto.catalogId = dependency.catalogId;
      depDto.name = dependency.name || '';
      depDto.version = dependency.version;
      exportDto.dependencies.push(depDto);
    }

    return exportDto;
  }

  async importRelease(dto: ImportReleaseDto): Promise<ImportReleaseResponseDto> {
    this.logger.log(`Importing release: ${dto.name}, version: ${dto.version}, project: ${dto.projectIdentifier}`);

    // Get user from context
    const user = this.cls.get('user');
    const userId = user?.email || user?.sub || 'system';
    this.logger.debug(`Import initiated by user: ${userId}`);

    // Convert projectIdentifier to projectId if it's a string
    let projectId: number;
    if (typeof dto.projectIdentifier !== 'number') {
      const project = await this.releaseRepo.manager.getRepository(ProjectEntity).findOneBy({ name: dto.projectIdentifier });
      if (!project) {
        throw new NotFoundException(`Project not found: ${dto.projectIdentifier}`);
      }
      projectId = project.id;
    } else {
      projectId = dto.projectIdentifier;
    }

    // Check if release already exists, or create new one
    const existingRelease = await this.releaseRepo.findOneBy({ project: { id: projectId }, version: dto.version });
    if (existingRelease) {
      throw new ConflictException(`Release version ${dto.version} already exists for project ${projectId}`);
    }

    // Create release entity
    const releaseEntity = this.releaseRepo.create();
    releaseEntity.project = { id: projectId } as unknown as ProjectEntity;
    releaseEntity.version = dto.version;
    releaseEntity.name = dto.name || dto.version; // Use version as name if name is not provided
    releaseEntity.releaseNotes = dto.releaseNotes || '';
    releaseEntity.metadata = dto.metadata || {};
    releaseEntity.status = ReleaseStatusEnum.DRAFT; // Always create as draft
    releaseEntity.createdBy = dto.author;
    releaseEntity.isImported = true; // Flag this release as imported
    releaseEntity.requiredRegulationsCount = await this.regulationRepo.count({ where: { project: { id: projectId } } });

    // Handle dependencies
    if (dto.dependencies && dto.dependencies.length > 0) {
      const dependencyCatalogIds = dto.dependencies.map(d => d.catalogId);
      releaseEntity.dependencies = await this.getAndValidateDependenciesForRelease(
        { projectId: projectId, version: dto.version },
        dependencyCatalogIds
      );
    }

    // Save release
    const savedRelease = await this.releaseRepo.save(releaseEntity);
    this.logger.log(`Created release with catalogId: ${savedRelease.catalogId}`);

    // Link default rule to imported release
    await this.linkDefaultRuleToRelease(savedRelease.catalogId);

    const bucketName = this.configService.get('BUCKET_NAME');

    // Import docker images synchronously (quick)
    for (const dockerImage of dto.dockerImages || []) {
      try {
        const artifactEntity = new ReleaseArtifactEntity();
        artifactEntity.type = ArtifactTypeEnum.DOCKER_IMAGE;
        artifactEntity.artifactName = dockerImage.name;
        artifactEntity.dockerImageUrl = dockerImage.imageUrl;
        artifactEntity.metadata = dockerImage.metadata || {};
        artifactEntity.release = savedRelease;
        artifactEntity.isInstallationFile = true;

        await this.artifactRepo.save(artifactEntity);
        this.logger.log(`Imported docker image: ${dockerImage.name}`);
      } catch (error) {
        this.logger.error(`Error importing docker image ${dockerImage.name}: ${error.message}`);
      }
    }

    // Start background file artifact imports (don't await)
    if (dto.artifacts && dto.artifacts.length > 0) {
      this.importArtifactsInBackground(savedRelease, dto.artifacts, 'release', bucketName).catch(error => {
        this.logger.error(`Background artifact import failed: ${error.message}`);
      });
    }

    await this.refreshReleaseState({ projectId: projectId, version: dto.version, projectIdentifier: projectId });

    const response = new ImportReleaseResponseDto();
    response.catalogId = savedRelease.catalogId;
    response.name = savedRelease.name;
    response.version = savedRelease.version;
    response.status = savedRelease.status;
    response.message = dto.artifacts && dto.artifacts.length > 0 
      ? 'Release created successfully. File artifacts are being uploaded in the background.'
      : 'Release imported successfully';

    return response;
  }

  /**
   * Import artifacts in the background without blocking the main request
   */
  private async importArtifactsInBackground(
    release: ReleaseEntity,
    artifacts: any[],
    userId: string,
    bucketName: string
  ): Promise<void> {
    this.logger.log(`Starting background import of ${artifacts.length} artifacts for release ${release.catalogId}`);
    
    const results = await Promise.all(
      artifacts.map(async (artifact) => {
        try {
          await this.importArtifact(release, artifact, userId, bucketName);
          return { name: artifact.name, success: true };
        } catch (error) {
          this.logger.error(`Error importing artifact ${artifact.name} in background: ${error.message}`);
          // Update file_upload to save the error message 
          const projectId = typeof release.project === 'object' && 'id' in release.project ? release.project.id : release.project;
          const dtoForKey = new CreateFileUploadUrlDto();
          dtoForKey.userId = 'release';
          dtoForKey.fileName = artifact.name;
          dtoForKey.objectKey = `${projectId}/${release.version}`;
          const objectKey = this.fileUploadService.createObjectKey(dtoForKey);
          await this.fileUploadService['uploadRepo'].update(
            { objectKey },
            { 
              status: FileUPloadStatusEnum.ERROR,
              error: error.message,
            }
          ).catch(err => {
            this.logger.error(`Failed to update file_upload error: ${err.message}`);
            throw new BadRequestException(`Failed to update file_upload status: ${err.message}`);
          });
          return { name: artifact.name, success: false };
        }
      })
    );

    // After all uploads, check if all succeeded
    const allSucceeded = results.every(r => r.success);
    if (allSucceeded && artifacts.length > 0) {
      // Set release status to RELEASED
      await this.releaseRepo.createQueryBuilder()
        .update()
        .set({
          status: ReleaseStatusEnum.RELEASED,
          releasedAt: () => `CASE WHEN released_at IS NULL THEN NOW() ELSE released_at END`
        })
        .where("catalog_id = :catalogId", { catalogId: release.catalogId })
        .execute();
      const projectId = typeof release.project === 'object' && 'id' in release.project ? release.project.id : release.project;
      await this.updateLatestForProject(projectId);
      await this.refreshReleaseState({ projectId: projectId, version: release.version, projectIdentifier: projectId });
      this.logger.log(`All artifacts imported successfully. Release ${release.catalogId} set to RELEASED.`);
    }
    this.logger.log(`Completed background import for release ${release.catalogId}`);
  }

  private async importArtifact(
    release: ReleaseEntity,
    artifact: any,
    userId: string,
    bucketName: string
  ): Promise<void> {

    this.logger.log(`Importing artifact: ${artifact.name} from URL: ${artifact.downloadUrl}`);

    // Create file upload entity with PENDING status
    const projectId = typeof release.project === 'object' && 'id' in release.project ? release.project.id : release.project;
    const dtoForKey = new CreateFileUploadUrlDto();
    dtoForKey.userId = userId;
    dtoForKey.fileName = artifact.name;
    dtoForKey.objectKey = `${projectId}/${release.version}`;
    const objectKey = this.fileUploadService.createObjectKey(dtoForKey);
    const fileUpload = new FileUploadEntity();
    fileUpload.fileName = artifact.name;
    fileUpload.objectKey = objectKey;
    fileUpload.userId = userId;
    fileUpload.bucketName = bucketName;
    fileUpload.status = FileUPloadStatusEnum.PENDING;

    const savedFileUpload = await this.fileUploadService['uploadRepo'].save(fileUpload);

    // Create release artifact immediately (before file upload)
    const artifactEntity = new ReleaseArtifactEntity();
    artifactEntity.type = ArtifactTypeEnum.FILE;
    artifactEntity.artifactName = artifact.name;
    artifactEntity.release = release;
    artifactEntity.fileUpload = savedFileUpload;
    //todo: get this property from dto
    artifactEntity.isInstallationFile = true;
    await this.artifactRepo.save(artifactEntity);
    if(artifact.downloadUrl){
        try {
        // Use fileUploadService to handle the entire download and upload process
        await this.fileUploadService.uploadFileFromUrl(
          savedFileUpload,
          artifact.downloadUrl,
          artifact.sha256
        );

        this.logger.log(`Successfully imported artifact: ${artifact.name}`);

      } catch (error) {
        this.logger.error(`Failed to import artifact ${artifact.name}: ${error.message}`);
        throw error;
      }
    }
    
  }

  /**
   * Calculate and update the totalSize in release metadata
   * totalSize = installationSize + artifactsSize
   */
  private async updateTotalSize(projectId: number, version: string): Promise<void> {
    this.logger.debug(`Calculating totalSize for project: ${projectId}, version: ${version}`);

    try {
      // Get the release with its artifacts and metadata
      const release = await this.releaseRepo.findOne({
        where: { project: { id: projectId }, version: version },
        relations: { artifacts: { fileUpload: true } }
      });

      if (!release) {
        this.logger.warn(`Release not found for project: ${projectId}, version: ${version}`);
        return;
      }

      // Calculate artifacts size (sum of all uploaded file sizes)
      const artifactsSize = release.artifacts
        ?.filter(artifact => artifact?.fileUpload?.size)
        ?.reduce((sum, artifact) => sum + Number(artifact.fileUpload.size || 0), 0) || 0;

      // Get installationSize from metadata (user-specified)
      const rawInstallationSize = release.metadata?.installationSize;
      const installationSize = Number.isFinite(Number(rawInstallationSize))
        ? Number(rawInstallationSize)
        : 0;

      // Calculate total size
      const totalSize = installationSize + artifactsSize;

      this.logger.debug(`Calculated sizes for ${version}: installationSize=${installationSize}, artifactsSize=${artifactsSize}, totalSize=${totalSize}`);

      // Update metadata with the new totalSize
      const updatedMetadata = {
        ...release.metadata,
        totalSize
      };

      await this.releaseRepo.update(
        { project: { id: projectId }, version: version },
        { metadata: updatedMetadata } as any
      );

      this.logger.debug(`Updated totalSize for project: ${projectId}, version: ${version}`);
    } catch (error) {
      this.logger.error(`Error updating totalSize for project: ${projectId}, version: ${version}: ${error.message}`);
    }
  }

  async getDeploymentReport(params: ReleaseParams): Promise<DeploymentReportDto> {
    try {
      this.logger.log(`Generating deployment report for project: ${params.projectId}, version: ${params.version}`);

      const release = await this.releaseRepo.findOneBy({
        project: { id: params.projectId },
        version: params.version,
      });

      if (!release) {
        throw new NotFoundException(`Release not found for project: ${params.projectId}, version: ${params.version}`);
      }

      // Get the catalog ID for this release
      const catalogId = release.catalogId;

      // Request delivery status from delivery microservice
      let deliveryStatuses = [];
      try {
        const deliveryResponse = await lastValueFrom(
          this.deliveryClient.send(DeliveryTopics.GET_DELIVERY_STATUSES, { catalogId })
        ) as any;
        deliveryStatuses = deliveryResponse || [];
      } catch (error) {
        this.logger.warn(`Failed to get delivery statuses from delivery service: ${error.message}`);
      }

      // Request deploy status from deploy microservice
      let deployStatuses = [];
      try {
        const deployResponse = await lastValueFrom(
          this.deployClient.send(DeployTopics.GET_DEPLOY_STATUSES, { catalogId })
        ) as any;
        deployStatuses = deployResponse || [];
      } catch (error) {
        this.logger.warn(`Failed to get deploy statuses from deploy service: ${error.message}`);
      }

      // Build a map of devices with their statuses
      const deviceMap = new Map<string, DeviceDeploymentDetailDto>();

      // Process delivery statuses
      deliveryStatuses.forEach((d) => {
        const deviceId = d.device?.ID || d.device;
        if (!deviceId) return;

        const status = d.deliveryStatus;
        // Include devices that are not cancelled or deleted
        if (status !== DeliveryStatusEnum.CANCELLED && status !== DeliveryStatusEnum.DELETED) {
          if (!deviceMap.has(deviceId)) {
            deviceMap.set(deviceId, {
              deviceId: deviceId,
              deviceName: d.device?.name || d.device?.Name,
              deliveryStatus: status,
              downloadTime: d.downloadDone,
            });
          } else {
            deviceMap.get(deviceId).deliveryStatus = status;
            deviceMap.get(deviceId).downloadTime = d.downloadDone;
          }
        }
      });

      // Process deploy statuses
      deployStatuses.forEach((d) => {
        const deviceId = d.device?.ID || d.device;
        if (!deviceId) return;

        const status = d.deployStatus;
        // Include devices that are not cancelled or uninstalled
        if (status !== DeployStatusEnum.CANCELLED && status !== DeployStatusEnum.UNINSTALL) {
          if (!deviceMap.has(deviceId)) {
            deviceMap.set(deviceId, {
              deviceId: deviceId,
              deviceName: d.device?.name || d.device?.Name,
              deployStatus: status,
              installationTime: d.deployDone,
            });
          } else {
            deviceMap.get(deviceId).deployStatus = status;
            deviceMap.get(deviceId).installationTime = d.deployDone;
            // Update device name if not already set
            if (!deviceMap.get(deviceId).deviceName && (d.device?.name || d.device?.Name)) {
              deviceMap.get(deviceId).deviceName = d.device?.name || d.device?.Name;
            }
          }
        }
      });

      // Convert map to array
      const devices = Array.from(deviceMap.values());

      // Count devices with different status
      const downloadedCount = new Set(
        deliveryStatuses
          .filter((d) => d.deliveryStatus === DeliveryStatusEnum.DONE)
          .map((d) => d.device?.ID || d.device)
      ).size;

      const installedCount = new Set(
        deployStatuses
          .filter((d) => d.deployStatus === DeployStatusEnum.DONE)
          .map((d) => d.device?.ID || d.device)
      ).size;


      // 'total' is the number of devices in the map (all with any delivery/deploy status)
      const total = deviceMap.size;

      // 'pending' is the number of devices that have not downloaded or are still downloading
      // We consider devices as pending if their deliveryStatus is not DONE (or is PENDING/IN_PROGRESS)
      const pending = Array.from(deviceMap.values()).filter(
        d => d.deliveryStatus !== DeliveryStatusEnum.DONE
      ).length;

      // Calculate deployment percentage
      let deploymentPercentage = 0;
      if (total > 0) {
        deploymentPercentage = (installedCount / total) * 100;
      }

      const report: DeploymentReportDto = {
        projectId: params.projectId,
        releaseName: release.name,
        version: params.version,
        downloadedCount,
        installedCount,
        total,
        pending,
        deploymentPercentage: Math.round(deploymentPercentage * 100) / 100, // Round to 2 decimal places
        devices,
      };

      this.logger.log(`Deployment report generated: ${JSON.stringify(report)}`);
      return report;
    } catch (error) {
      this.logger.error(`Error generating deployment report: ${error.message}`);
      throw error;
    }
  }
}