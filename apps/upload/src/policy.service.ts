import { Injectable, UnauthorizedException, Inject, Logger } from '@nestjs/common';
import { RuleService } from '@app/common/rules/services';
import { CreatePolicyDto, UpdateRuleDto, PolicyQueryDto, CreateRuleFieldDto } from '@app/common/rules/dto';
import { RuleType } from '@app/common/rules/enums/rule.enums';
import { PROJECT_ACCESS_SERVICE, ProjectAccessService } from '@app/common/utils/project-access';
import { RuleValidationService } from '@app/common/rules/services/rule-validation.service';

@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);

  constructor(
    private readonly ruleService: RuleService,
    private readonly ruleValidationService: RuleValidationService,
    @Inject(PROJECT_ACCESS_SERVICE) 
    private readonly uploadService: ProjectAccessService & { 
      getUserProjectIds: (email: string) => Promise<number[]>; 
      getProjectIdsByNames: (names: string[]) => Promise<number[]>;
    },
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
   * Deletes a policy with user access validation
   */
  async deletePolicyForUser(id: string, userEmail: string) {
    const policy = await this.getPolicy(id);
    await this.validateUserAccessToPolicy(policy, userEmail);
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
    const policy = await this.getPolicy(id);
    await this.validateUserAccessToPolicy(policy, userEmail);
    return policy;
  }

  /**
   * Lists all policies with optional filters
   */
  async listPolicies(query: PolicyQueryDto, projectIds?: number[]) {
    // Force type to be policy if not already set
    if (!query.type) {
      query.type = RuleType.POLICY;
    }
    
    const rules = await this.ruleService.findAll(query, projectIds);
    return rules.map(rule => this.ruleService.ruleEntityToDefinition(rule));
  }

  /**
   * Lists all policies for a specific user
   * Filters by projects the user has access to
   */
  async listPoliciesForUser(query: PolicyQueryDto, userEmail: string) {
    if (!userEmail) {
      throw new UnauthorizedException('User authentication required to retrieve policies');
    }

    const projectIds = await this.uploadService.getUserProjectIds(userEmail);
    return this.listPolicies(query, projectIds);
  }

  /**
   * Gets all policies associated with a specific release by catalog ID
   */
  async getPoliciesForRelease(catalogId: string) {
    const query: PolicyQueryDto = {
      releaseId: catalogId,
      type: RuleType.POLICY,
    };
    
    const rules = await this.ruleService.findAll(query);
    return rules.map(rule => this.ruleService.ruleEntityToDefinition(rule));
  }

  /**
   * Gets all available rule fields from the database
   */
  async getAvailableFields() {
    return this.ruleValidationService.getAvailableFields();
  }

  /**
   * Adds a new rule field to the database
   */
  async addRuleField(fieldData: any) {
    return this.ruleValidationService.addRuleField(fieldData);
  }

  /**
   * Removes a rule field from the database
   */
  async removeRuleField(fieldName: string) {
    return this.ruleValidationService.removeRuleField(fieldName);
  }

  /**
   * Validates that a user has access to a policy's associated projects
   * @throws UnauthorizedException if user is not authenticated or doesn't have access
   */
  private async validateUserAccessToPolicy(policy: any, userEmail: string): Promise<void> {
    if (!userEmail) {
      throw new UnauthorizedException('User authentication required to access policy');
    }

    const userProjectIds = await this.uploadService.getUserProjectIds(userEmail);
    
    // Get project IDs from policy's associated project names
    const policyProjectNames = policy.association?.releases?.map(r => r.projectName) || [];
    const policyProjectIds = await this.uploadService.getProjectIdsByNames(policyProjectNames);
    
    // Check if user has access to any of the policy's associated projects
    const hasAccess = policyProjectIds.some(projectId => userProjectIds.includes(projectId));
    
    if (!hasAccess) {
      throw new UnauthorizedException('You do not have access to this policy');
    }
  }

  /**
   * Syncs device fields to the rule_fields table
   * Compares incoming fields from device with existing fields in database
   * and adds new fields that don't exist yet
   */
  async syncDeviceFields(data: { deviceId: string; fields: Array<{ name: string; type: string; label?: string; description?: string }> }): Promise<void> {
    this.logger.log(`Syncing ${data.fields.length} field(s) from device ${data.deviceId}`);

    try {
      // Get all existing fields from database
      const existingFields = await this.ruleValidationService.getAvailableFields();
      const existingFieldNames = new Set(existingFields.map(f => f.name));

      // Filter out fields that already exist
      const newFields = data.fields.filter(field => !existingFieldNames.has(field.name));

      if (newFields.length === 0) {
        this.logger.debug(`No new fields to add from device ${data.deviceId}`);
        return;
      }

      this.logger.log(`Found ${newFields.length} new field(s) to add from device ${data.deviceId}`);

      // Add each new field to the database
      for (const field of newFields) {
        try {
          await this.ruleValidationService.addRuleField({
            name: field.name,
            type: field.type,
            label: field.label || field.name,
            description: field.description || `Field reported by device ${data.deviceId}`,
          });
          this.logger.debug(`Successfully added new field: ${field.name} (type: ${field.type})`);
        } catch (err) {
          // Log error but continue with other fields
          this.logger.error(`Failed to add field ${field.name} from device ${data.deviceId}: ${err.message}`);
        }
      }

      this.logger.log(`Successfully synced ${newFields.length} new field(s) from device ${data.deviceId}`);
    } catch (err) {
      this.logger.error(`Error syncing device fields from device ${data.deviceId}: ${err.message}`);
      throw err;
    }
  }
}
