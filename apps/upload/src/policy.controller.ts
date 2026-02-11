import { Controller, Logger, Inject, UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { MessagePattern, Ctx, Payload } from '@nestjs/microservices';
import { UploadTopics } from '@app/common/microservice-client/topics';
import { CreatePolicyDto, UpdateRuleDto, PolicyQueryDto, CreateRuleFieldDto } from '@app/common/rules/dto';
import { PolicyService } from './policy.service';
import { ValidateProjectAnyAccess, ValidateProjectListAccess, PROJECT_ACCESS_SERVICE, ProjectAccessService } from '@app/common/utils/project-access';

@Controller()
export class PolicyController {
  private readonly logger = new Logger(PolicyController.name);

  constructor(
    private readonly policyService: PolicyService,
    @Inject(PROJECT_ACCESS_SERVICE) private readonly uploadService: ProjectAccessService & { getUserProjectIds: (email: string) => Promise<number[]> },
  ) {}

  private getUserEmailFromPayload(payload: any): string | undefined {
    const rawUser = payload?.headers?.user;

    if (!rawUser) {
      return undefined;
    }

    if (typeof rawUser === 'string') {
      try {
        const parsed = JSON.parse(rawUser);
        return parsed?.email;
      } catch {
        return undefined;
      }
    }

    return rawUser?.email;
  }

  private extractUserEmailFromContext(context: any, payload: any): string | undefined {
    // Try to get user from Kafka context (RPC context with data/headers)
    let headers = context?.args?.[0]?.headers || context?.getMessage()?.headers;

    if (headers) {
      const rawUser = headers.user;
      if (rawUser) {
        if (typeof rawUser === 'string') {
          try {
            const parsed = JSON.parse(rawUser);
            return parsed?.email;
          } catch {
            // Fallback to payload if context parsing fails
          }
        } else {
          return rawUser?.email;
        }
      }
    }

    // Fallback to extracting from payload
    return this.getUserEmailFromPayload(payload);
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
  async createPolicy(@Payload() Payload: any) {
    this.logger.log('Creating policy');
    const { value: createPolicyDto , headers } = Payload ;
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
  async updatePolicy(@Payload() payload: any) {
    const data = payload.value || payload;
    this.logger.log(`Updating policy ${data.id}`);
    return this.policyService.updatePolicy(data.id, data.data);
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
