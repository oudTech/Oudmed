import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

class OpeningStockDto {
  @IsInt() @Min(1) quantity: number;
  @IsDateString() expiryDate: string;
  @IsOptional() @IsString() @MaxLength(60) batchNumber?: string;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;
}

export class CreateDrugDto {
  @IsOptional() @IsString() @MaxLength(40) sku?: string;
  @IsString() @MinLength(2) @MaxLength(160) name: string;
  @IsOptional() @IsString() @MaxLength(160) genericName?: string;
  @IsOptional() @IsString() @MaxLength(160) brandName?: string;
  @IsOptional() @IsString() @MaxLength(40) form?: string;
  @IsOptional() @IsString() @MaxLength(40) strength?: string;
  @IsOptional() @IsString() @MaxLength(20) packaging?: string;
  @IsOptional() @IsString() @MaxLength(20) unitLabel?: string;
  @IsNumber() @Min(0) sellPrice: number;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;
  @IsOptional() @IsInt() @Min(0) reorderLevel?: number;
  @IsOptional() @IsString() @MaxLength(500) comments?: string;
  @IsOptional() @ValidateNested() @Type(() => OpeningStockDto) openingStock?: OpeningStockDto;
}

export class UpdateDrugDto {
  @IsOptional() @IsString() @MaxLength(40) sku?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(160) genericName?: string;
  @IsOptional() @IsString() @MaxLength(160) brandName?: string;
  @IsOptional() @IsString() @MaxLength(40) form?: string;
  @IsOptional() @IsString() @MaxLength(40) strength?: string;
  @IsOptional() @IsString() @MaxLength(20) packaging?: string;
  @IsOptional() @IsString() @MaxLength(20) unitLabel?: string;
  @IsOptional() @IsNumber() @Min(0) sellPrice?: number;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;
  @IsOptional() @IsInt() @Min(0) reorderLevel?: number;
  @IsOptional() @IsString() @MaxLength(500) comments?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ReceiveBatchDto {
  @IsInt() @Min(1) quantity: number;
  @IsDateString() expiryDate: string;
  @IsOptional() @IsString() @MaxLength(60) batchNumber?: string;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;
  @IsOptional() @IsString() @MaxLength(120) supplier?: string;
}

export class AdjustStockDto {
  @IsInt() delta: number;
  @IsString() @MinLength(2) @MaxLength(300) reason: string;
}

export class ImportDrugsDto {
  @IsArray() @ArrayMaxSize(2000)
  rows: Record<string, unknown>[];
}

export class ListDrugsQueryDto {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsIn(['all', 'low', 'out', 'expiring']) filter?: 'all' | 'low' | 'out' | 'expiring';
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;
}
