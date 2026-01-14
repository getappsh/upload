import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { RuleService } from '@app/common/rules/services';
import { CreatePolicyDto, UpdateRuleDto, RuleQueryDto, CreateRuleFieldDto } from '@app/common/rules/dto';
import { RuleType } from '@app/common/rules/enums/rule.enums';
import { PROJECT_ACCESS_SERVICE, ProjectAccessService } from '@app/common/utils/project-access';
import { MicroserviceClient, MicroserviceName } from '@app/common/microservice-client';
import { DeviceTopics } from '@app/common/microservice-client/topics';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class PolicyService {
  constructor(
    private readonly ruleService: RuleService,
    @Inject(PROJECT_ACCESS_SERVICE) private readonly uploadService: ProjectAccessService & { getUserProjectIds: (email: string) => Promise<number[]>; getProjectIdsByNames: (names: string[]) => Promise<number[]> },
    @Inject(MicroserviceName.DEVICE_SERVICE) private readonly deviceClient: MicroserviceClient,
  ) {}

  /**
   * Creates a new policy (release-associated rule)
   */
  async createPolicy(createPolicyDto: CreatePolicyDto) {
    // Convert to internal CreateRuleDto format
    const createRuleDto = {
      ...createPolicyDto,
      type: RuleType.POLICY,
    };
    
    const rule = await this.ruleService.createRule(createRuleDto);
    return this.ruleService.ruleEntityToDefinition(rule);
  }

  /**
   * Updates an existing policy
   */
  async updatePolicy(id: string, updateRuleDto: UpdateRuleDto) {
    const rule = await this.ruleService.updateRule(id, updateRuleDto);
    return this.ruleService.ruleEntityToDefinition(rule);
  }

  /**
   * Deletes a policy
   */
  async deletePolicy(id: string) {
    return this.ruleService.deleteRule(id);
  }

  /**
   * Gets a specific policy by ID
   */
  async getPolicy(id: string) {
    const rule = await this.ruleService.findOneById(id);
    return this.ruleService.ruleEntityToDefinition(rule);
  }

  /**
   * Gets a specific policy by ID with user access validation
   */
  async getPolicyForUser(id: string, userEmail: string) {
    if (!userEmail) {
      throw new UnauthorizedException('User authentication required to retrieve policy');
    }

    const policy = await this.getPolicy(id);
    const userProjectIds = await this.uploadService.getUserProjectIds(userEmail);
    
    // Get project IDs from policy's associated project names
    const policyProjectNames = policy.association?.releases?.map(r => r.projectName) || [];
    const policyProjectIds = await this.uploadService.getProjectIdsByNames(policyProjectNames);
    
    // Check if user has access to any of the policy's associated projects
    const hasAccess = policyProjectIds.some(projectId => userProjectIds.includes(projectId));
    
    if (!hasAccess) {
      throw new UnauthorizedException('You do not have access to this policy');
    }

    return policy;
  }

  /**
   * Lists all policies with optional filters
   */
  async listPolicies(query: RuleQueryDto, projectIds?: number[]) {
    // Force type to be policy
    query.type = RuleType.POLICY;
    
    const rules = await this.ruleService.findAll(query, projectIds);
    return rules.map(rule => this.ruleService.ruleEntityToDefinition(rule));
  }

  /**
   * Lists all policies for a specific user
   * Filters by projects the user has access to
   */
  async listPoliciesForUser(query: RuleQueryDto, userEmail: string) {
    if (!userEmail) {
      throw new UnauthorizedException('User authentication required to retrieve policies');
    }

    const projectIds = await this.uploadService.getUserProjectIds(userEmail);
    return this.listPolicies(query, projectIds);
  }

  /**
   * Gets all available rule fields from discovery service via Kafka
   */
  async getAvailableFields() {
    return firstValueFrom(
      this.deviceClient.send(DeviceTopics.GET_RULE_FIELDS, {})
    );
  }

  /**
   * Adds a new rule field via discovery service via Kafka
   */
  async addRuleField(fieldData: any) {
    return firstValueFrom(
      this.deviceClient.send(DeviceTopics.ADD_RULE_FIELD, fieldData)
    );
  }

  /**
   * Removes a rule field via discovery service via Kafka
   */
  async removeRuleField(fieldName: string) {
    return firstValueFrom(
      this.deviceClient.send(DeviceTopics.REMOVE_RULE_FIELD, fieldName)
    );
  }
}
