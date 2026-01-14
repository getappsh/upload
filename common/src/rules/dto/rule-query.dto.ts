import { IsOptional, IsBoolean, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RuleQueryDto {
  @ApiPropertyOptional({ description: 'Project identifier (ID or name)' })
  @IsOptional()
  projectIdentifier?: string | number;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Filter by release ID' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  releaseId?: number;
}
