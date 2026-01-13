import { Controller, Logger, Inject, UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { MessagePattern, Ctx, Payload } from '@nestjs/microservices';
import { UploadTopics } from '@app/common/microservice-client/topics';
import { CreatePolicyDto, UpdateRuleDto, RuleQueryDto, CreateRuleFieldDto } from '@app/common/rules/dto';
import { PolicyService } from './policy.service';
import { ValidateProjectAnyAccess, ValidateProjectListAccess, PROJECT_ACCESS_SERVICE, ProjectAccessService } from '@app/common/utils/project-access';

@Controller()
export class PolicyController {
  private readonly logger = new Logger(PolicyController.name);

  constructor(
    private readonly policyService: PolicyService,
    @Inject(PROJECT_ACCESS_SERVICE) private readonly uploadService: ProjectAccessService & { getUserProjectIds: (email: string) => Promise<number[]> },
  ) {}

  /**
   * Get all policies
   * Filters policies based on projects the user has access to
   */
  @MessagePattern(UploadTopics.GET_POLICIES)
  async getPolicies(@Payload() payload: any) {
    this.logger.log('Getting policies');
    const query = payload.value || payload || {};
    const userEmail = payload.headers?.user?.email;
    return this.policyService.listPoliciesForUser(query, userEmail);
  }

  /**
   * Create a new policy
   */
  @ValidateProjectListAccess('association.releases')
  @MessagePattern('getapp-upload.create-policy')
  async createPolicy(@Payload() createPolicyDto: CreatePolicyDto) {
    this.logger.log('Creating policy');
    return this.policyService.createPolicy(createPolicyDto);
  }

  /**
   * Get a specific policy by ID
   */
  @ValidateProjectAnyAccess()
  @MessagePattern('getapp-upload.get-policy')
  async getPolicy(@Payload() id: string) {
    this.logger.log(`Getting policy ${id}`);
    return this.policyService.getPolicy(id);
  }

  /**
   * Update a policy
   */
  @ValidateProjectListAccess((payload: any) => {
    // For updates, extract from the data.association.releases if present
    if (payload.data?.association?.releases) {
      return payload.data.association.releases.map((r: any) => r.projectName);
    }
    return [];
  })
  @MessagePattern('getapp-upload.update-policy')
  async updatePolicy(@Payload() payload: { id: string; data: UpdateRuleDto }) {
    this.logger.log(`Updating policy ${payload.id}`);
    return this.policyService.updatePolicy(payload.id, payload.data);
  }

  /**
   * Delete a policy
   */
  @ValidateProjectAnyAccess()
  @MessagePattern('getapp-upload.delete-policy')
  async deletePolicy(@Payload() id: string) {
    this.logger.log(`Deleting policy ${id}`);
    return this.policyService.deletePolicy(id);
  }

  /**
   * Get available rule fields
   */
  @MessagePattern('getapp-upload.get-rule-fields')
  async getAvailableFields() {
    this.logger.log('Getting available rule fields');
    return this.policyService.getAvailableFields();
  }

  /**
   * Add a new rule field
   */
  @MessagePattern('getapp-upload.add-rule-field')
  async addRuleField(@Payload() fieldData: CreateRuleFieldDto) {
    this.logger.log('Adding rule field');
    return this.policyService.addRuleField(fieldData);
  }

  /**
   * Remove a rule field
   */
  @MessagePattern('getapp-upload.remove-rule-field')
  async removeRuleField(@Payload() fieldName: string) {
    this.logger.log(`Removing rule field ${fieldName}`);
    return this.policyService.removeRuleField(fieldName);
  }
}
