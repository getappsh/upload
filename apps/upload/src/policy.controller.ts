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
   * Get policies associated with a specific release
   */
  @MessagePattern(UploadTopics.GET_POLICIES_FOR_RELEASE)
  async getPoliciesForRelease(@Payload() payload: any) {
    const catalogId = payload.value || payload;
    this.logger.log(`Getting policies for release ${catalogId}`);
    return this.policyService.getPoliciesForRelease(catalogId);
  }

  /**
   * Create a new policy
   */
  @ValidateProjectListAccess('association.releases')
  @MessagePattern(UploadTopics.CREATE_POLICY)
  async createPolicy(@Payload() Payload: any) {
    this.logger.log('Creating policy');
    const { value: createPolicyDto , headers } = Payload ;
    return this.policyService.createPolicy(createPolicyDto);
  }

  /**
   * Get a specific policy by ID
   */
  @MessagePattern(UploadTopics.GET_POLICY)
  async getPolicy(@Payload() payload: any) {
    const id = payload.value || payload;
    const userEmail = payload.headers?.user?.email;
    this.logger.log(`Getting policy ${id}`);
    return this.policyService.getPolicyForUser(id, userEmail);
  }

  /**
   * Update a policy
   */
  @ValidateProjectListAccess((payload: any) => {
    // For updates, extract from the data.association.releases if present
    const data = payload.value || payload;
    if (data.data?.association?.releases) {
      return data.data.association.releases.map((r: any) => r.projectName);
    }
    return [];
  })
  @MessagePattern(UploadTopics.UPDATE_POLICY)
  async updatePolicy(@Payload() payload: any) {
    const data = payload.value || payload;
    this.logger.log(`Updating policy ${data.id}`);
    return this.policyService.updatePolicy(data.id, data.data);
  }

  /**
   * Delete a policy
   */
  @MessagePattern(UploadTopics.DELETE_POLICY)
  async deletePolicy(@Payload() payload: any) {
    const id = payload.value || payload;
    const userEmail = payload.headers?.user?.email;
    this.logger.log(`Deleting policy ${id}`);
    return this.policyService.deletePolicyForUser(id, userEmail);
  }

  /**
   * Get available rule fields
   */
  @MessagePattern(UploadTopics.GET_RULE_FIELDS)
  async getAvailableFields() {
    this.logger.log('Getting available rule fields');
    return this.policyService.getAvailableFields();
  }

  /**
   * Add a new rule field
   */
  @MessagePattern(UploadTopics.ADD_RULE_FIELD)
  async addRuleField(@Payload() fieldData: CreateRuleFieldDto) {
    this.logger.log('Adding rule field');
    return this.policyService.addRuleField(fieldData);
  }

  /**
   * Remove a rule field
   */
  @MessagePattern(UploadTopics.REMOVE_RULE_FIELD)
  async removeRuleField(@Payload() fieldName: string) {
    this.logger.log(`Removing rule field ${fieldName}`);
    return this.policyService.removeRuleField(fieldName);
  }
}
