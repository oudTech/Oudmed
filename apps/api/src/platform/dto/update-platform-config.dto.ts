import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdatePlatformConfigDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) platformName?: string;
  @IsOptional() @Transform(trim) @IsEmail() supportEmail?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(30) supportPhone?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) supportHours?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2) defaultCountry?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(8) defaultCurrency?: string;
  @IsOptional() @IsString() @MaxLength(8) timeFormat?: string;
}

export class SetMaintenanceModeDto {
  @IsBoolean() maintenanceMode: boolean;
}
