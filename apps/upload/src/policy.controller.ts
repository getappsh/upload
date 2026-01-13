import { Controller, Logger } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { UploadTopics } from '@app/common/microservice-client/topics';
import { RpcPayload } from '@app/common/microservice-client';
import { CreatePolicyDto, UpdateRuleDto, RuleQueryDto, CreateRuleFieldDto } from '@app/common/rules/dto';
import { PolicyService } from './policy.service';
import { ValidateProjectAnyAccess } from '@app/common/utils/project-access';

@Controller()
export class PolicyController {
  private readonly logger = new Logger(PolicyController.name);

  constructor(private readonly policyService: PolicyService) {}

  /**
   * Get all policies
   */
  @ValidateProjectAnyAccess()
  @MessagePattern(UploadTopics.GET_POLICIES)
  async getPolicies(@RpcPayload() query: RuleQueryDto) {
    this.logger.log('Getting policies');
    return this.policyService.listPolicies(query || {});
  }

  /**
   * Create a new policy
   */
  @ValidateProjectAnyAccess()
  @MessagePattern('getapp-upload.create-policy')
  async createPolicy(@RpcPayload() createPolicyDto: CreatePolicyDto) {
    this.logger.log('Creating policy');
    return this.policyService.createPolicy(createPolicyDto);
  }

  /**
   * Get a specific policy by ID
   */
  @ValidateProjectAnyAccess()
  @MessagePattern('getapp-upload.get-policy')
  async getPolicy(@RpcPayload() id: string) {
    this.logger.log(`Getting policy ${id}`);
    return this.policyService.getPolicy(id);
  }

  /**
   * Update a policy
   */
  @ValidateProjectAnyAccess()
  @MessagePattern('getapp-upload.update-policy')
  async updatePolicy(@RpcPayload() payload: { id: string; data: UpdateRuleDto }) {
    this.logger.log(`Updating policy ${payload.id}`);
    return this.policyService.updatePolicy(payload.id, payload.data);
  }

  /**
   * Delete a policy
   */
  @ValidateProjectAnyAccess()
  @MessagePattern('getapp-upload.delete-policy')
  async deletePolicy(@RpcPayload() id: string) {
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
  async addRuleField(@RpcPayload() fieldData: CreateRuleFieldDto) {
    this.logger.log('Adding rule field');
    return this.policyService.addRuleField(fieldData);
  }

  /**
   * Remove a rule field
   */
  @MessagePattern('getapp-upload.remove-rule-field')
  async removeRuleField(@RpcPayload() fieldName: string) {
    this.logger.log(`Removing rule field ${fieldName}`);
    return this.policyService.removeRuleField(fieldName);
  }
}
