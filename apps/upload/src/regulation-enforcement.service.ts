import { RegulationEntity, ReleaseArtifactEntity } from "@app/common/database/entities";
import { Injectable, Logger } from "@nestjs/common";
import { JUnitParserService } from "./utils/junit-parser.service";
import { FileUploadService } from "./file-upload.service";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

@Injectable()
export class RegulationEnforcementService {
  private readonly logger = new Logger(RegulationEnforcementService.name);

  constructor(
    private readonly junitParser: JUnitParserService,
    private readonly fileUploadService: FileUploadService,
    @InjectRepository(ReleaseArtifactEntity) private readonly artifactRepo: Repository<ReleaseArtifactEntity>,    
  ){}

  async enforce(regulation: RegulationEntity, value: string): Promise<boolean> {
    this.logger.log(`Enforce regulation: ${regulation.name}, type: ${regulation.type.name}, value: ${value}`);
    switch (regulation.type.name) {
      case 'Boolean':
        return "true" === value;
      
      case 'Threshold':
        if (isNaN(+value)) return false;
        return Number(regulation.config) <= Number(value);

      case 'JUnit':
        if (isNaN(+value)) return false;
        const xmlContent = await this.getJUnitXmlContent(Number(value));
        const summary = this.junitParser.extractSummary(xmlContent);
        const passPercentage = (summary.passed / summary.total) * 100;


        this.logger.log(`Test Summary: ${JSON.stringify(summary)}`); 
        this.logger.debug(`Pass Percentage: ${passPercentage}`);

        return Number(regulation.config) <= Number(passPercentage)

      default:
        throw new Error(`Unsupported regulation type: ${regulation.type.name}`);
    }
  }
  

  private async getJUnitXmlContent(artifactId: number): Promise<string> {
    const artifact = await this.artifactRepo.findOneOrFail({where: {id: artifactId}, relations: ['fileUpload'], select: {fileUpload: {id: true}}});
    const stream = await this.fileUploadService.getFileStream(artifact.fileUpload?.id);
  
    const chunks = [];  
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}
