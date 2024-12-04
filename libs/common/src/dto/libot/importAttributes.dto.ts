import { CreateImportDto } from "@app/common/dto/map"
import { Validators } from "./utils/validators"
import { Feature, Polygon, bbox, bboxPolygon, polygon } from "@turf/turf"
import { MapEntity } from "@app/common/database/entities"
import { MapProductResDto } from "../map/dto/map-product-res.dto"

export class ImportAttributes {
  product: MapProductResDto
  pattern: "bbox" | "polygon"
  private _bBox: [number, number, number, number];
  private _polygon: Feature<Polygon>;
  private _pointsString: string
  zoomLevel: number
  targetResolution: number
  minResolutionDeg: number
  fileName: string
  requestId: string
  jobId: string

  toString() {
    return JSON.stringify(this);
  }

  public get BBox() {
    return this._bBox
  }

  public get Polygon() {
    return this._polygon
  }

  public get Points() {
    return this._pointsString
  }

  public set Points(bBox: string) {
    let poly: number[][] | false
    if (Validators.isValidStringForBBox(bBox)) {
      this._pointsString = bBox
      this.setBBoxString(bBox)
      this._polygon = bboxPolygon(this._bBox)
      this.pattern = "bbox"
    } else if ((poly = Validators.isValidStringForPolygon(bBox))) {
      this._pointsString = bBox
      const fePoly = polygon([poly])
      this._polygon = fePoly
      this._bBox = bbox(fePoly) as [number, number, number, number]
      this.pattern = "polygon"
    } else {
      throw new Error("Points box values are invalid.");
    }
    // this._BoundingBox = bBox
  }

  setBBoxString(bBox: string) {
    const bBoxValues = Validators.bBoxStringToBboxArray(bBox)
    let bbox = [] as unknown as [number, number, number, number];
    bbox[0] = bBoxValues[0];
    bbox[1] = bBoxValues[1];
    bbox[2] = bBoxValues[2];
    bbox[3] = bBoxValues[3];
    this._bBox = bbox
  }

  static fromImportCreateDto(importDto: CreateImportDto): ImportAttributes {
    const attr = new ImportAttributes()
    attr.Points = importDto.mapProperties.boundingBox
    return attr
  }
  
  static fromFootprint(mE: MapEntity): ImportAttributes {
    const attr = new ImportAttributes()
    attr.Points = mE.footprint
    return attr
  }
}

