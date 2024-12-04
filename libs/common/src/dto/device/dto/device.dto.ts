import { DeviceEntity, DeviceMapStateEntity, DiscoveryMessageEntity } from "@app/common/database/entities";
import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsDate, IsNotEmpty, IsNumber, IsString, Max, Min } from "class-validator";
import { timeout } from 'rxjs';

export class DeviceDto {

  @ApiProperty({ required: false })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ required: false })
  @IsDate()
  lastUpdatedDate: Date

  @ApiProperty({ required: false })
  @IsString()
  OS: string

  @ApiProperty({ required: false })
  @IsString()
  availableStorage: string

  @ApiProperty({ required: false })
  @Min(0)
  @Max(100)
  power: number;

  @ApiProperty({ required: false })
  @IsNumber()
  bandwidth: number;

  @ApiProperty({ required: false })
  @IsBoolean()
  operativeState: true



  static fromDeviceEntity(deviceE: DeviceEntity, discoveryE: DiscoveryMessageEntity): DeviceDto {
    let device = new DeviceDto()
    device.id = deviceE.ID;
    device.lastUpdatedDate = deviceE.lastUpdatedDate
    device.OS = deviceE.OS
    device.availableStorage = deviceE.availableStorage;
    device.power = discoveryE.situationalDevice.power;
    device.bandwidth = discoveryE.situationalDevice.bandwidth;
    device.operativeState = discoveryE.situationalDevice.operativeState;

    return device
  }

  toString() {
    return JSON.stringify(this);
  }
}