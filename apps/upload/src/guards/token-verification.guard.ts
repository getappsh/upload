import { CanActivate, ExecutionContext, Logger } from "@nestjs/common";
import { Injectable } from "@nestjs/common/decorators/core/injectable.decorator";
import { UploadService } from "../upload.service";

@Injectable()
export class TokenVerificationGuard implements CanActivate {

    private readonly logger =  new Logger(TokenVerificationGuard.name)
    constructor(private readonly uploadService: UploadService){}
    
    async canActivate(context: ExecutionContext){
        const request = context.switchToHttp().getRequest();
        const uploadToken = request?.uploadToken ?? request?.value?.uploadToken;
        const project = await this.uploadService.verifyToken(uploadToken)
        if (!project){
            this.logger.debug(`Not allowed to upload to this project, token: ${request.uploadToken}`)
            return false;
        }
        request.project = project;
        return true
    }
}