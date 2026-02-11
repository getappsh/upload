import { Controller, Logger, Inject, UnauthorizedException } from '@nestjs/common';
import { MessagePattern, Ctx, Payload } from '@nestjs/microservices';
import { UploadTopics } from '@app/common/microservice-client/topics';
import { CreatePolicyDto, UpdateRuleDto, PolicyQueryDto, CreateRuleFieldDto } from '@app/common/rules/dto';
import { PolicyService } from './policy.service';
import { ValidateProjectAnyAccess, ValidateProjectListAccess, PROJECT_ACCESS_SERVICE, ProjectAccessService } from '@app/common/utils/project-access';
import { RpcPayload } from '@app/common/microservice-client';

@Controller()
export class PolicyController {
  private readonly logger = new Logger(PolicyController.name);

  constructor(
    private readonly policyService: PolicyService,
    @Inject(PROJECT_ACCESS_SERVICE) private readonly uploadService: ProjectAccessService & { getUserProjectIds: (email: string) => Promise<number[]> },
  ) {}

  private extractUserEmailFromContext(context: any, payload: any): string | undefined {
    // Try to extract user from Kafka context
    try {
      // For Kafka: context is RpcArgumentsHost with args[0] containing {data, headers}
      if (context?.args && Array.isArray(context.args) && context.args[0]) {
        const headers = context.args[0].headers;
        if (headers?.user) {
          return this.parseUserEmail(headers.user);
        }
      }
    } catch (e) {
      this.logger.debug('Failed to extract user from Kafka context');
    }

    // Try to extract from payload headers (formatDataV2 structure)
    if (payload?.headers?.user) {
      return this.parseUserEmail(payload.headers.user);
    }

    // Fallback: try direct payload
    if (payload?.user) {
      return this.parseUserEmail(payload.user);
    }

    this.logger.debug('No user found in context or payload');
    return undefined;
  }

  private parseUserEmail(rawUser: any): string | undefined {
    if (!rawUser) {
      return undefined;
    }

    // Handle JSON string
    if (typeof rawUser === 'string') {
      try {
        const parsed = JSON.parse(rawUser);
        return parsed?.email;
      } catch {
        return undefined;
      }
    }

    // Handle object
    return rawUser?.email;
  }

  /**
   * Get all policies
   * Filters policies based on projects the user has access to
   */
  @MessagePattern(UploadTopics.GET_POLICIES)
  async getPolicies(@Payload() payload: any, @Ctx() context: any) {
    this.logger.log('Getting policies');
    const query = payload.value || payload || {};
    const userEmail = this.extractUserEmailFromContext(context, payload);
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
  async createPolicy(@RpcPayload() createPolicyDto: CreatePolicyDto) {
    this.logger.log('Creating policy');
    return this.policyService.createPolicy(createPolicyDto);
  }

  /**
   * Get a specific policy by ID
   */
  @MessagePattern(UploadTopics.GET_POLICY)
  async getPolicy(@Payload() payload: any, @Ctx() context: any) {
    const id = payload.value || payload;
    const userEmail = this.extractUserEmailFromContext(context, payload);
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
  async updatePolicy(@RpcPayload() payload: { id: string; data: UpdateRuleDto }) {
    this.logger.log(`Updating policy ${payload.id}`);
    return this.policyService.updatePolicy(payload.id, payload.data);
  }

  /**
   * Delete a policy
   */
  @MessagePattern(UploadTopics.DELETE_POLICY)
  async deletePolicy(@Payload() payload: any, @Ctx() context: any) {
    const id = payload.value || payload;
    const userEmail = this.extractUserEmailFromContext(context, payload);
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
  async addRuleField(@Payload() payload: any) {
    const fieldData = payload.value || payload;
    this.logger.log('Adding rule field');
    return this.policyService.addRuleField(fieldData);
  }

  /**
   * Remove a rule field
   */
  @MessagePattern(UploadTopics.REMOVE_RULE_FIELD)
  async removeRuleField(@Payload() payload: any) {
    const fieldName = payload.value || payload;
    this.logger.log(`Removing rule field ${fieldName}`);
    return this.policyService.removeRuleField(fieldName);
  }
}
