import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateFileDto {
    @IsBoolean()
    isExecutable: boolean;

    @IsOptional()
    @IsString({ each: true })
    arguments?: string[];
}