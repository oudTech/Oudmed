import { Transform } from 'class-transformer';
import { IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateSettingsDto {
  @Transform(trim) @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(250) address?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(120) contactEmail?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(160) website?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(60) rcNumber?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(60) taxId?: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @Transform(trim) @IsOptional() @IsString() @MinLength(1) @MaxLength(12) invoicePrefix?: string;
  @Transform(trim) @IsOptional() @IsString() @MinLength(1) @MaxLength(12) receiptPrefix?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(500) documentFooter?: string;
}
