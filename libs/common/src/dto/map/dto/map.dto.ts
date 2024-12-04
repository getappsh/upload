import { MapEntity } from "@app/common/database/entities";
import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";
import { MapProductResDto } from "./map-product-res.dto";

export class MapDto {

  @ApiProperty({ required: false })
  catalogId: string;

  @ApiProperty({ required: false })
  name: string;

  @ApiProperty({ required: false })
  createDate: Date;

  @ApiProperty({ required: false })
  exportEndDate: Date;

  @ApiProperty({ required: false })
  boundingBox: string;
  
  @ApiProperty({ required: false })
  footprint: string;

  @ApiProperty({ required: false })
  size: number;
  
  @ApiProperty({ required: false })
  area: number;

  @ApiProperty({ required: false })
  status: string;

  @ApiProperty({ required: false })
  fileName: string;

  @ApiProperty({ required: false })
  packageUrl: string;

  @ApiProperty({ required: false })
  isUpdate: boolean;

  @ApiProperty({ required: false })
  product: MapProductResDto;

  static fromMapEntity(mapEntity: MapEntity) {
    let map = new MapDto();
    map.catalogId = mapEntity.catalogId;
    map.name = mapEntity.name;
    map.createDate = mapEntity.createDateTime;
    map.boundingBox = mapEntity.boundingBox;
    map.packageUrl = mapEntity.packageUrl;
    map.isUpdate = mapEntity.isUpdated
    map.product = mapEntity.mapProduct

    return map
  }

  toString() {
    return JSON.stringify(this);
  }
}