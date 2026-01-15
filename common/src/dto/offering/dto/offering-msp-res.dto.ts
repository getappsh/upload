import { ApiProperty, IntersectionType } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsOptional, ValidateNested } from "class-validator";
import { RestrictionDto } from "../../discovery";
import { OfferingMapProductsResDto } from "./offering-map-products-res.dto";
import { OfferingMapPushResDto } from "./offering-map-push-res.dto";


export class OfferingMapResDto extends IntersectionType(
  OfferingMapPushResDto,
  OfferingMapProductsResDto,
){

  @ApiProperty({ 
    type: () => [RestrictionDto],
    required: false,
    description: 'Restrictions applicable to this device based on device type, device ID, and OS'
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestrictionDto)
  restrictions?: RestrictionDto[]

  toString(){
    return JSON.stringify(this)
  }
}