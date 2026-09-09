import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';

const ASSIGNABLE_ROLES = [
  'HOSPITAL_ADMIN',
  'DOCTOR',
  'NURSE',
  'RECEPTIONIST',
  'PHARMACIST',
  'LAB_STAFF',
  'ACCOUNTANT',
] as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ListStaffQueryDto {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsIn([...ASSIGNABLE_ROLES, 'SUPER_ADMIN']) role?: string;
  @IsOptional() @IsIn(['all', 'active', 'inactive']) status?: 'all' | 'active' | 'inactive';
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;
}

export class CreateStaffDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) firstName: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) lastName: string;
  @Transform(trim) @IsEmail() email: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsIn(ASSIGNABLE_ROLES) role: Role;
  @IsOptional() @IsString() @MaxLength(80) jobTitle?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID(undefined, { each: true }) departmentIds?: string[];
  @IsString() @MinLength(8) @MaxLength(72) password: string;
}

export class UpdateStaffDto {
  @Transform(trim) @IsOptional() @IsString() @MinLength(1) @MaxLength(80) firstName?: string;
  @Transform(trim) @IsOptional() @IsString() @MinLength(1) @MaxLength(80) lastName?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsIn(ASSIGNABLE_ROLES) role?: Role;
  @IsOptional() @IsString() @MaxLength(80) jobTitle?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID(undefined, { each: true }) departmentIds?: string[];
}

export class SetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(72) password: string;
}
