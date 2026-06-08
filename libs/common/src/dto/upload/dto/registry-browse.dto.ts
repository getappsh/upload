import { ArtifactTypeEnum } from "@app/common/database/entities";
import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class BrowseRegistryDto {
  @ApiProperty({ required: false, enum: ArtifactTypeEnum, description: 'Filter by artifact type (file, docker_image)' })
  @IsOptional()
  @IsEnum(ArtifactTypeEnum)
  type?: ArtifactTypeEnum;

  @ApiProperty({ required: false, description: 'Filter/search by name (supports partial match for autocomplete)' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false, default: 1, description: 'Page number (1-based)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiProperty({ required: false, default: 50, description: 'Number of items per page (max 200)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  pageSize?: number = 50;

  @ApiProperty({ required: false, description: 'Docker registry name to query (if multiple configured)' })
  @IsOptional()
  @IsString()
  registry?: string;
}

export class RegistryItemDto {
  @ApiProperty({ description: 'Full path/identifier of the artifact in its registry' })
  name: string;

  @ApiProperty({ enum: ArtifactTypeEnum, description: 'Type of artifact' })
  type: ArtifactTypeEnum;

  @ApiProperty({ required: false, description: 'Size in bytes (if available)' })
  size?: number;

  @ApiProperty({ required: false, description: 'Last modified date (if available)' })
  lastModified?: Date;

  @ApiProperty({ required: false, description: 'Tag or version (for docker images)' })
  tag?: string;
}

export class BrowseRegistryResponseDto {
  @ApiProperty({ type: [RegistryItemDto] })
  items: RegistryItemDto[];

  @ApiProperty({ description: 'Total number of items matching the filter' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Number of items per page' })
  pageSize: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;
}

export class LinkExistingArtifactDto {
  @ApiProperty({ description: 'Project identifier (ID or name)' })
  projectIdentifier: string | number;

  projectId: number;

  @ApiProperty({ description: 'Release version to link the artifact to' })
  @IsString()
  version: string;

  @ApiProperty({ description: 'Name for the artifact in this release' })
  @IsString()
  artifactName: string;

  @ApiProperty({ enum: ArtifactTypeEnum, description: 'Type of artifact being linked' })
  @IsEnum(ArtifactTypeEnum)
  type: ArtifactTypeEnum;

  @ApiProperty({ required: false, description: 'The object key in MinIO/S3 (for file type)' })
  @IsOptional()
  @IsString()
  objectKey?: string;

  @ApiProperty({ required: false, description: 'Docker image URL (for docker_image type)' })
  @IsOptional()
  @IsString()
  dockerImageUrl?: string;

  @ApiProperty({ required: false, type: 'object' })
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  isInstallationFile?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  isExecutable?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  arguments?: string;
}
