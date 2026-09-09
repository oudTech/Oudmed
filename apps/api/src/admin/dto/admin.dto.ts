import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { InsuranceKind } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListQueryDto {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() @MaxLength(20) kind?: string;
  @IsOptional() @IsString() status?: 'all' | 'active' | 'inactive';
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;
}

export class DepartmentDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(20) code?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class UpdateDepartmentDto {
  @Transform(trim) @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(20) code?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class ServiceItemDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(30) code?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsNumber() @Min(0) unitPrice: number;
}

export class UpdateServiceItemDto {
  @Transform(trim) @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(30) code?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
}

export class InsuranceProviderDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsEnum(InsuranceKind) kind: InsuranceKind;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(250) address?: string;
  @IsOptional() @IsString() @MaxLength(120) contactPerson?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class UpdateInsuranceProviderDto {
  @Transform(trim) @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsEnum(InsuranceKind) kind?: InsuranceKind;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(250) address?: string;
  @IsOptional() @IsString() @MaxLength(120) contactPerson?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
