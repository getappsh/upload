import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { RuleService, RuleValidationService } from '@app/common/rules/services';
import { CreatePolicyDto, UpdateRuleDto, RuleQueryDto, CreateRuleFieldDto } from '@app/common/rules/dto';
import { RuleType } from '@app/common/rules/enums/rule.enums';
import { PROJECT_ACCESS_SERVICE, ProjectAccessService } from '@app/common/utils/project-access';

@Injectable()
export class PolicyService {
  constructor(
    private readonly ruleService: RuleService,
    private readonly ruleValidationService: RuleValidationService,
    @Inject(PROJECT_ACCESS_SERVICE) private readonly uploadService: ProjectAccessService & { getUserProjectIds: (email: string) => Promise<number[]> },
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
   * Gets all available rule fields
   */
  async getAvailableFields() {
    return this.ruleValidationService.getAvailableFields();
  }

  /**
   * Adds a new rule field
   */
  async addRuleField(fieldData: any) {
    return this.ruleValidationService.addRuleField(fieldData);
  }

  /**
   * Removes a rule field
   */
  async removeRuleField(fieldName: string) {
    return this.ruleValidationService.removeRuleField(fieldName);
  }
}
