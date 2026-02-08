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


  toString(){
    return JSON.stringify(this)
  }
}