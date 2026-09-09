import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { FacilityType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateTenantDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsEnum(FacilityType)
  facilityType: FacilityType;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @MaxLength(2)
  @MinLength(2)
  country: string; // ISO 3166-1 alpha-2

  @IsOptional()
  @IsString()
  @MaxLength(20)
  staffSizeBand?: string;
}
