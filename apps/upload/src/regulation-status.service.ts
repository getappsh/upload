import { RegulationEntity, RegulationStatusEntity, ReleaseEntity } from "@app/common/database/entities";
import { RegulationStatusDto, RegulationStatusParams, ReleaseParams, SetRegulationCompliancyDto, SetRegulationStatusDto } from "@app/common/dto/upload";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, JsonContains, Repository } from "typeorm";
import { RegulationEnforcementService } from "./regulation-enforcement.service";


@Injectable()
export class RegulationStatusService {
  private readonly logger = new Logger(RegulationStatusService.name)


  constructor(
    @InjectRepository(RegulationStatusEntity) private readonly regulationStatusRepo: Repository<RegulationStatusEntity>,
    @InjectRepository(RegulationEntity) private readonly regulationRepo: Repository<RegulationEntity>,
    @InjectRepository(ReleaseEntity) private readonly releaseRepo: Repository<ReleaseEntity>,
    private readonly enforcementService: RegulationEnforcementService,
  ){}

  private async getRegulationAndRelease(params: RegulationStatusParams): Promise<{regulation: RegulationEntity, release: ReleaseEntity}> {
    this.logger.debug(`Get regulation and release of regulation: ${params.regulation} version: ${params.version} projectID: ${params.projectId}`);
    
    const [regulationEntity, releaseEntity] = await Promise.all([
      this.regulationRepo.findOne({where: {name: params.regulation, project: {id: params.projectId}}}),
      this.releaseRepo.findOne({ where: { version: params.version, project: { id: params.projectId } } })
    ]);
    if (!releaseEntity) {
      throw new NotFoundException(`Version ${params.version} for Project ID ${params.projectId} not found`);
    }
    if (!regulationEntity) {
      throw new NotFoundException(`Regulation ${params.regulation} for Project ID ${params.projectId} not found`);
    }

    return {regulation: regulationEntity, release: releaseEntity};
  }
  
  private createRegulationSnapshot(regulation: RegulationEntity): Record<string, any> {
    return {
      name: regulation.displayName ?? regulation.name,
      description: regulation.description,
      config: regulation.config,
      typeId: regulation.type.id,
    }
  }

  async setRegulationStatus(dto: SetRegulationStatusDto): Promise<RegulationStatusDto> {
    this.logger.log('Set regulation status');

    const {regulation, release} = await this.getRegulationAndRelease(dto);
    const isCompliant = await this.enforcementService.enforce(regulation, dto.value);
    
    let regulationSnapshot = null;
    if (isCompliant) {
      regulationSnapshot = this.createRegulationSnapshot(regulation);
    }

    await this.regulationStatusRepo
      .createQueryBuilder()
      .insert()
      .values({
        value: dto.value,
        reportDetails: dto.reportDetails,
        isCompliant: isCompliant,
        version: release,
        regulation: regulation,
        regulationSnapshot: regulationSnapshot
      })
      .orUpdate(
        ['value', 'report_details', 'is_compliant', 'regulation_snapshot'],
        "regulation_version_unique_constraint",
       )
      .execute();
          
    return this.getVersionRegulationStatus(dto);
  }


  async setComplianceStatus(dto: SetRegulationCompliancyDto): Promise<RegulationStatusDto> {
    this.logger.log('Set compliance status');
    const {regulation, release} = await this.getRegulationAndRelease(dto);

    let regulationSnapshot = null;
    if (dto.isCompliant) {
      regulationSnapshot = this.createRegulationSnapshot(regulation);
    }
    await this.regulationStatusRepo
      .createQueryBuilder()
      .insert()
      .values({
        isCompliant: dto.isCompliant,
        version: release,
        regulation: regulation,
        regulationSnapshot: regulationSnapshot
      })
      .orUpdate(
        ['is_compliant', 'regulation_snapshot'],
        "regulation_version_unique_constraint",
      )
      .execute();
    

    return this.getVersionRegulationStatus(dto);
  }
  
  async getVersionRegulationStatus(params: RegulationStatusParams): Promise<RegulationStatusDto> {
    this.logger.debug('Get regulation status');
    const regulationStatus = await this.regulationStatusRepo.findOne({ 
      select: {version: {version: true}, regulation: {name: true, project: {id: true}}},
      relations: {version: true, regulation: {project: true}},
      where: [
        {
          version: {version: params.version, project: {id: params.projectId}},
          regulationSnapshot: JsonContains({name: params.regulation})
        },
        {
          version: {version: params.version, project: {id: params.projectId}},
          regulation: {name: params.regulation}
        }
      ]
    });

    if (!regulationStatus) {
      throw new NotFoundException(`Regulation status with regulation ${params.regulation} for Project ID ${params.projectId} not found`);
    }
    return new RegulationStatusDto().fromRegulationStatusEntity(regulationStatus);
  }

  async getVersionRegulationsStatuses(params: ReleaseParams): Promise<RegulationStatusDto[]> {
    this.logger.log(`Get regulation statuses for project id ${params.projectId} and version id ${params.version}`);

    const regulationStatuses = await this.regulationStatusRepo.find({ 
      select: {version: {version: true}, regulation: {name: true, project: {id: true}}},
      relations: {version: true, regulation: {project: true}},
      where: { 
        version: {version: params.version, project: {id: params.projectId}},
        },
      order: {regulation: {order: 'ASC'}} 
      });

    this.logger.debug(`Regulations status found: ${regulationStatuses.length}`);
    return regulationStatuses.map(rs => new RegulationStatusDto().fromRegulationStatusEntity(rs));
  }

  async deleteVersionRegulationStatus(params: RegulationStatusParams) {
    this.logger.log(`Delete regulation status with regulation ${params.regulation} for Project ID ${params.projectId} and versionId ${params.version}`);

    const status = await this.regulationStatusRepo.findOne({ 
      where: [
        {
          version: {version: params.version, project: {id: params.projectId}},
          regulationSnapshot: JsonContains({name: params.regulation})
        },
        {
          version: {version: params.version, project: {id: params.projectId}},
          regulation: {name: params.regulation}
        }
      ]
    });

    // TODO: Delete file if needed?
    let res 
    if (status) {
      res = await this.regulationStatusRepo.delete({
        id: status.id
      });
      this.logger.debug(`Regulation status deleted: ${res.raw}, affected: ${res.affected}`);
    }
    
    if (!status || res?.affected == 0) {
      throw new NotFoundException(`Regulation status with regulation ${params.regulation} for Project ID ${params.projectId} and versionId ${params.version} not found`);
    }
    return "Regulation status deleted";
  }

  async deleteOrphanRegulationStatuses(params: ReleaseParams) {
    this.logger.debug(`Delete orphan regulation status with Project ID ${params.projectId} and versionId ${params.version}`);
    const statues = await this.regulationStatusRepo.find({
      where: {
        version: {version: params.version, project: {id: params.projectId}},
      regulation: IsNull(),
      regulationSnapshot: IsNull()
      }
    })
    await this.regulationStatusRepo.remove(statues);
    this.logger.debug(`Orphan regulation status deleted`);
  }
}