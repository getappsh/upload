import { ReleaseEntity, ReleaseStatusEnum } from "@app/common/database/entities";
import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsSemVer, IsString, IsBoolean, IsNumber} from "class-validator";
import { ReleaseArtifactDto } from "./release-artifact.dto";
import { Type } from "class-transformer";
import { ProjectIdentifierParams } from "../../project-management";

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

  @ApiProperty({ required: false, type: 'object' })
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiProperty({ required: false, default: true })
  @IsBoolean()
  @IsOptional()
  isDraft?: boolean = true;

}

export class ReleaseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  version: string;

  @ApiProperty({ required: false })
  projectId?: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  releaseNotes: string;

  @ApiProperty()
  metadata: Record<string, any>;

  @ApiProperty({ type: 'enum', enum: ReleaseStatusEnum })
  status: ReleaseStatusEnum;

  @ApiProperty({ type: ReleaseArtifactDto, isArray: true, required: false })
  artifacts?: ReleaseArtifactDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ description: 'Total number of required regulations' })
  requiredRegulationsCount: number;

  @ApiProperty({ description: 'Total number of compliant regulations' })
  compliantRegulationsCount: number;

  static fromEntity(release: ReleaseEntity): ReleaseDto {
    const dto = new ReleaseDto();
    dto.version = release.version;
    dto.id = release.catalogId;
    dto.projectId = release?.project?.id;
    dto.name = release.name;
    dto.releaseNotes = release.releaseNotes;
    dto.metadata = release.metadata;
    dto.status = release.status;
    dto.artifacts = release?.artifacts?.map((artifact) => ReleaseArtifactDto.fromEntity(artifact));
    dto.createdAt = release.createdAt;
    dto.updatedAt = release.updatedAt;
    dto.requiredRegulationsCount = release.requiredRegulationsCount;
    dto.compliantRegulationsCount = release.compliantRegulationsCount;
    return dto;
  }
}


export class ReleaseParams extends ProjectIdentifierParams{
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