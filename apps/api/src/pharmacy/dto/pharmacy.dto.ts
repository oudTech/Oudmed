import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class DispenseItemDto {
  @IsUUID() itemId: string;
  @IsInt() @Min(0) quantity: number;
  @IsNumber() @Min(0) unitPrice: number;
}

export class DispenseDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DispenseItemDto)
  items: DispenseItemDto[];

  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
