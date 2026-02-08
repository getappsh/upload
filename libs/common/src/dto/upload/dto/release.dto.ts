import { ProjectType, ReleaseEntity, ReleaseStatusEnum } from "@app/common/database/entities";
import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsSemVer, IsString, IsBoolean } from "class-validator";
import { ReleaseArtifactDto } from "./release-artifact.dto";
import { Type } from "class-transformer";
import { ProjectIdentifierParams } from "@app/common/dto/project-management";

/**
 * Post-install action types
 */
export enum PostInstallActionType {
  NONE = 'NONE',
  WEB = 'WEB',
  EXE = 'EXE'
}

/**
 * Post-install action configuration
 */
export class PostInstallAction {
  @ApiProperty({ enum: PostInstallActionType, description: 'Action type: NONE (no action), WEB (open URL), or EXE (run executable)' })
  type: PostInstallActionType;

  @ApiProperty({ required: false, description: 'URL to open (required when type is WEB)' })
  url?: string;

  @ApiProperty({ required: false, description: 'Executable path to run (required when type is EXE)' })
  exePath?: string;
}

/**
 * Release metadata configuration
 * 
 * This class documents common metadata properties, but metadata can contain
 * any additional user-defined keys. The structure is flexible and extensible.
 */
export class ReleaseMetadata {
  @ApiProperty({ required: false, description: 'Enable automatic deployment of this release' })
  autoDeploy?: boolean;

  @ApiProperty({ required: false, type: PostInstallAction, description: 'Post-installation action configuration' })
  postInstallAction?: PostInstallAction;

  @ApiProperty({ required: false, type: 'integer', description: 'Installation size in bytes - disk space required after installation (user-specified)' })
  installationSize?: number;

  @ApiProperty({ required: false, type: 'integer', description: 'Total size in bytes - automatically calculated as installationSize + artifactsSize' })
  totalSize?: number;

  @ApiProperty({ required: false, description: 'Additional user-defined metadata properties (flexible structure)' })
  [key: string]: any;
}

export class SetReleaseDto {

  projectIdentifier: string | number

  projectId: number

  @ApiProperty()
  @IsSemVer()
  version: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  releaseNotes?: string;

  @ApiProperty({ required: false, type: ReleaseMetadata, description: 'Release metadata including autoDeploy and postInstallAction configuration. Additional user-defined properties are supported.' })
  @IsOptional()
  metadata?: ReleaseMetadata;

  @ApiProperty({ required: false, default: true })
  @IsBoolean()
  @IsOptional()
  isDraft?: boolean = true;

  @ApiProperty({ required: false, type: String, isArray: true, description: 'List of dependencies. Providing an empty array will remove all dependencies. Omitting this field or setting it to null will leave dependencies unchanged.' })
  @IsOptional()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  dependencies?: string[]

  toString() {
    return JSON.stringify(this)
  }

}

export class ReleaseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  version: string;

  @ApiProperty()
  projectName: string;

  @ApiProperty({ required: false })
  projectId?: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  releaseNotes: string;

  @ApiProperty({ type: ReleaseMetadata, description: 'Release metadata including autoDeploy and postInstallAction configuration. Additional user-defined properties are supported.' })
  metadata: ReleaseMetadata;

  @ApiProperty({ type: 'enum', enum: ReleaseStatusEnum })
  status: ReleaseStatusEnum;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ description: 'Total number of required regulations' })
  requiredRegulationsCount: number;

  @ApiProperty({ description: 'Total number of compliant regulations' })
  compliantRegulationsCount: number;

  @ApiProperty()
  latest: boolean

  @ApiProperty({ required: false })
  releasedAt?: Date

  @ApiProperty({ required: false })
  createdBy?: string

  @ApiProperty({ required: false })
  updatedBy?: string

  @ApiProperty({ description: 'Indicates if this release was imported from another system' })
  isImported: boolean

  @ApiProperty({ description: 'Indicates if this release is read-only (imported releases that are released)' })
  readonly: boolean

  static fromEntity(release: ReleaseEntity, userCanEditImported?: boolean): ReleaseDto {
    const dto = new ReleaseDto();
    dto.version = release.version;
    dto.id = release.catalogId;
    dto.projectId = release?.project?.id;
    dto.projectName = release?.project?.name;
    dto.name = release.name || "";
    dto.releaseNotes = release.releaseNotes ?? "";
    dto.metadata = release.metadata;
    dto.status = release.status;
    dto.createdAt = release.createdAt;
    dto.updatedAt = release.updatedAt;
    dto.requiredRegulationsCount = release.requiredRegulationsCount;
    dto.compliantRegulationsCount = release.compliantRegulationsCount;
    dto.latest = release.latest;
    dto.releasedAt = release.releasedAt ?? undefined;
    dto.createdBy = release.createdBy ?? undefined;
    dto.updatedBy = release.updatedBy ?? undefined;
    dto.isImported = release.isImported ?? false;
    // Readonly if it's imported AND released, but user doesn't have edit permission
    dto.readonly = dto.isImported && release.status === ReleaseStatusEnum.RELEASED && !userCanEditImported;

    return dto;
  }

  toString() {
    return JSON.stringify(this)
  }
}

export class DetailedReleaseDto extends ReleaseDto {

  @ApiProperty({ type: ReleaseArtifactDto, isArray: true, required: false })
  artifacts?: ReleaseArtifactDto[];

  @ApiProperty({ type: ReleaseDto, isArray: true, required: false })
  dependencies: ReleaseDto[]


  static fromEntity(release: ReleaseEntity, userCanEditImported?: boolean): DetailedReleaseDto {
    const baseDto = super.fromEntity(release, userCanEditImported);
    const dto = new DetailedReleaseDto();

    Object.assign(dto, baseDto);

    dto.artifacts = release?.artifacts?.map(art => ReleaseArtifactDto.fromEntity(art))
    dto.dependencies = release?.dependencies?.map(dep => ReleaseDto.fromEntity(dep, userCanEditImported))

    return dto

  }
}

export class ComponentV2Dto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  version: string;

  @ApiProperty()
  projectName: string;

  @ApiProperty({ required: false })
  releaseNotes?: string;

  @ApiProperty({ required: false, type: ReleaseMetadata, description: 'Component metadata including autoDeploy and postInstallAction configuration. Additional user-defined properties are supported.' })
  metadata?: ReleaseMetadata;

  @ApiProperty({ type: 'enum', enum: ReleaseStatusEnum })
  status: ReleaseStatusEnum;

  @ApiProperty({ type: 'enum', enum: ProjectType })
  type: ProjectType

  @ApiProperty({ type: 'integer', format: 'int64', required: false })
  size?: number

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ required: false })
  latest?: boolean

  @ApiProperty({ required: false })
  releasedAt?: Date

  static fromEntity(release: ReleaseEntity): ComponentV2Dto {
    const dto = new ComponentV2Dto();
    dto.version = release.version;
    dto.id = release.catalogId;
    dto.releaseNotes = release.releaseNotes;
    dto.metadata = release.metadata;
    dto.status = release.status;
    dto.createdAt = release.createdAt;
    dto.updatedAt = release.updatedAt;
    dto.projectName = release.project.name;
    dto.type = release.project.projectType;
    dto.latest = release.latest;
    dto.releasedAt = release.releasedAt ?? undefined;
    dto.size = release?.artifacts
      ?.filter(a => a.isInstallationFile)
      ?.map(a => a?.fileUpload?.size ?? 0)
      ?.reduce((size, a) => size + a, 0);
    return dto;
  }

  static fromPendingVersion(pendingVersion: any): ComponentV2Dto {
    const dto = new ComponentV2Dto();
    dto.id = pendingVersion.catalogId || `${pendingVersion.projectName}@${pendingVersion.version}`;
    dto.version = pendingVersion.version;
    dto.projectName = pendingVersion.projectName;
    dto.status = ReleaseStatusEnum.DRAFT;
    dto.type = ProjectType.PRODUCT;
    dto.createdAt = pendingVersion.firstReportedDate;
    dto.updatedAt = pendingVersion.lastReportedDate;
    dto.releaseNotes = `Version reported by device but not registered in getapp`;
    dto.metadata = pendingVersion.metadata || {};
    dto.latest = false;
    return dto;
  }

  toString() {
    return JSON.stringify(this)
  }
}

export class ReleaseParams extends ProjectIdentifierParams {
  @ApiProperty()
  @IsSemVer()
  @Type(() => String)
  version: string

  constructor(projectId: number, version: string) {
    super()
    this.projectId = projectId;
    this.version = version;
  }
}
