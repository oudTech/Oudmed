import { IsEmail, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateContactInquiryDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName: string;

  @Transform(lower)
  @IsEmail()
  email: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  phone: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message: string;

  @IsString()
  turnstileToken: string;

  /** Honeypot - real visitors never see or fill this field. */
  @IsOptional()
  @IsString()
  website?: string;

  /** Client timestamp (ms) captured when the form first rendered - used for the time-trap check. */
  @IsNumber()
  formRenderedAt: number;
}
