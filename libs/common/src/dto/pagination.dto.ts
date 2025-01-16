import { applyDecorators, Type } from "@nestjs/common";
import { ApiExtraModels, ApiOkResponse, ApiProperty, getSchemaPath } from "@nestjs/swagger";

export class PaginatedResultDto<T> {
  @ApiProperty({ description: 'The data items for the current page', isArray: true })
  data: T[];

  @ApiProperty({ description: 'The total number of items available', example: 100 })
  total: number;

  @ApiProperty({ description: 'The current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'The number of items per page', example: 10 })
  perPage: number;

}

export const ApiOkResponsePaginated = <DataDto extends Type<unknown>>(dataDto: DataDto) =>
  applyDecorators(
    ApiExtraModels(PaginatedResultDto, dataDto),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(PaginatedResultDto) },
          {
            properties: {
              data: {
                type: 'array',
                items: { $ref: getSchemaPath(dataDto) },
              },
            },
          },
        ],
      },
    }),
  )