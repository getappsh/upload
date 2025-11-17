import { IsBoolean, IsOptional, IsString } from "class-validator";

export class UpdateFileDto {

    @IsOptional()
    @IsString()
    arguments?: string;
    
    @IsOptional()
    @IsBoolean()
    isExecutable?: boolean;

}