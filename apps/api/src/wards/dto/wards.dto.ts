import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BedStatus, WardType } from '@prisma/client';

export class CreateWardDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsEnum(WardType) wardType: WardType;
  @IsOptional() @IsInt() @Min(0) @Max(200) bedCount?: number;
  @IsOptional() @IsString() @MaxLength(8) bedPrefix?: string;
}

export class UpdateWardDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsEnum(WardType) wardType?: WardType;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AddBedsDto {
  @IsOptional() @IsInt() @Min(1) @Max(100) count?: number;
  @IsOptional() @IsString() @MaxLength(8) prefix?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) labels?: string[];
}

export class UpdateBedDto {
  @IsOptional() @IsString() @MaxLength(20) label?: string;
  @IsOptional() @IsEnum(BedStatus) status?: BedStatus;
}
