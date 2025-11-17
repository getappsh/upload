import { 
  IsBoolean, 
  IsNumber, 
  IsOptional, 
  IsString, 
  Validate, 
  ValidatorConstraint, 
  ValidatorConstraintInterface, 
  ValidationArguments 
} from "class-validator";

@ValidatorConstraint({ name: 'FileMetaDataRequirement', async: false })
class FileMetaDataRequirement implements ValidatorConstraintInterface {
  validate(dto: any) {
    const hasId = dto.id !== undefined && dto.id !== null;
    const hasReleaseAndArtifact = !!dto.releaseId && !!dto.artifactName;

    return hasId || hasReleaseAndArtifact;
  }

  defaultMessage() {
    return 'You must provide either "id" OR both "releaseId" and "artifactName".';
  }
}

export class UpdateFileMetaDataDto {

  // 👇 Attach validator here — this makes it class-level.
  @Validate(FileMetaDataRequirement)
  private readonly _classValidator!: boolean;

  @IsOptional()
  @IsNumber()
  id?: number;

  @IsOptional()
  @IsString()
  releaseId?: string;

  @IsOptional()
  @IsString()
  artifactName?: string;

  @IsOptional()
  @IsString()
  arguments?: string;

  @IsOptional()
  @IsBoolean()
  isExecutable?: boolean;
}
