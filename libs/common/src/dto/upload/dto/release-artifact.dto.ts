import { ArtifactTypeEnum, ReleaseArtifactEntity } from "@app/common/database/entities";
import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean } from "class-validator";

export class SetReleaseArtifactDto {
  projectId: number
  
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectToken: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  artifactName: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  releaseId: string

  @ApiProperty({ required: false, type: 'enum', enum: ArtifactTypeEnum, default: ArtifactTypeEnum.FILE })
  @IsOptional()
  @IsEnum(ArtifactTypeEnum)
  type: ArtifactTypeEnum = ArtifactTypeEnum.FILE

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isInstallationFile: boolean = false;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  dockerImageUrl?: string

  @ApiProperty({ required: false, type: 'object' })
  @IsOptional()
  metadata?: Record<string, any>;
  
}


export class SetReleaseArtifactResDto {

  @ApiProperty()
  artifactId: number

  @ApiProperty({required: false, description: 'Only present for FILE artifact type' })
  uploadUrl: string;
}


export class ReleaseArtifactDto{

  @ApiProperty()
  id: number

  @ApiProperty()
  artifactName: string

  @ApiProperty()
  type: ArtifactTypeEnum

  @ApiProperty()
  metadata: Record<string, any>

  @ApiProperty()
  isInstallationFile: boolean

  @ApiProperty({required: false })
  dockerImageUrl?: string

  @ApiProperty()
  uploadId: number


  static fromEntity(artifact: ReleaseArtifactEntity): ReleaseArtifactDto {
    const dto = new ReleaseArtifactDto();
    dto.id = artifact.id,
    dto.artifactName = artifact.artifactName,
    dto.type = artifact.type,
    dto.metadata = artifact.metadata,
    dto.isInstallationFile = artifact.isInstallationFile,
    dto.dockerImageUrl = artifact?.dockerImageUrl,
    dto.uploadId = artifact.fileUpload ? artifact.fileUpload.id : null

    return dto
    
  }
}
