import { CanActivate, ExecutionContext, ForbiddenException, Logger } from "@nestjs/common";
import { Injectable } from "@nestjs/common/decorators/core/injectable.decorator";
import { UploadService } from "../upload.service";
import { extractHeaders, extractRequest } from "@app/common/microservice-client";
import { Reflector } from "@nestjs/core";

@Injectable()
export class TokenVerificationGuard implements CanActivate {

    private readonly logger =  new Logger(TokenVerificationGuard.name)
    constructor(private readonly uploadService: UploadService, private reflector: Reflector){}
    
    async canActivate(context: ExecutionContext){
        const roles = this.reflector.get<string[]>('roles', context.getHandler());

        const request = extractRequest(context)
        const headers = extractHeaders(context)

        let projectIdentifier = request.projectIdentifier ?? request?.projectId;
        if (!projectIdentifier){
            throw new ForbiddenException(`Project Identifier is not found in the request.`);
        }

        const user = headers?.user;
        const projectToken = headers?.projectToken;

        let project
        if (projectToken){
            project = await this.uploadService.verifyToken(projectToken)
        }else if (user?.email){
            const memberProject = await this.uploadService.getMemberInProjectByEmail(projectIdentifier, user?.email);

            if (!memberProject){
                throw new ForbiddenException(`User ${user?.email} is not a member of the project.`);
            }

            if (roles?.length > 0) {
                const hasRole = roles.some(role => role == memberProject?.role);
                if (!hasRole){
                    throw new ForbiddenException(`User ${user?.email} does not have the required role.`);
                }
            }

            project = memberProject?.project
        }else{
            throw new ForbiddenException(`Not allowed in this project: ${projectIdentifier}`)
        }
        
        if (!project || (project.id != projectIdentifier && project.name != projectIdentifier)){
            throw new ForbiddenException(`Not allowed in this project: ${projectIdentifier}`)
        }

        request.projectId = project.id;
        request.project = project;
        return true
    }
}