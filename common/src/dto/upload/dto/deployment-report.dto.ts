import { ApiProperty } from "@nestjs/swagger";

export class DeploymentReportDto {
  @ApiProperty({ description: 'Project ID', type: Number })
  projectId: number;

  @ApiProperty({ description: 'Release name', type: String })
  releaseName: string;

  @ApiProperty({ description: 'Release version', type: String })
  version: string;

  @ApiProperty({ description: 'Number of devices that have downloaded the release', type: Number })
  downloadedCount: number;

  @ApiProperty({ description: 'Number of devices with the release installed', type: Number })
  installedCount: number;

  @ApiProperty({ description: 'Number of devices with ongoing delivery process (includes devices waiting for download and mid-deployment)', type: Number })
  activeDeliveryCount: number;

  @ApiProperty({ description: 'Number of devices the release is offered to based on device type', type: Number })
  offeredDevicesCount: number;

  @ApiProperty({ description: 'Deployment percentage calculated as (installedCount / activeDeliveryCount) * 100', type: Number })
  deploymentPercentage: number;
}

export class GetDeploymentReportParams {
  @ApiProperty({ description: 'Project ID or name', type: [Number, String] })
  projectIdentifier: number | string;

  @ApiProperty({ description: 'Release version' })
  version: string;
}
