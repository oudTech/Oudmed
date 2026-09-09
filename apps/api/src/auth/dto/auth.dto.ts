import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const SLUG_RULE = /^[a-z0-9-]+$/;

export class RegisterDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @Transform(lower)
  @IsEmail()
  email: string;

  @IsString()
  @Matches(PASSWORD_RULE, {
    message: 'Password must be at least 8 characters and include a letter and a number',
  })
  @MaxLength(200)
  password: string;

  @IsBoolean()
  acceptedTerms: boolean;
}

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  pendingToken: string;

  @IsString()
  @Length(6, 6)
  code: string;
}

export class ResendVerificationDto {
  @IsString()
  @IsNotEmpty()
  pendingToken: string;
}

export class LoginDto {
  @Transform(lower)
  @IsString()
  @Matches(SLUG_RULE)
  @MaxLength(63)
  tenantSlug: string;

  @Transform(lower)
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;
}

export class RedeemTicketDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  ticket: string;
}

export class ForgotPasswordDto {
  @Transform(lower)
  @IsString()
  @Matches(SLUG_RULE)
  @MaxLength(63)
  tenantSlug: string;

  @Transform(lower)
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @Matches(PASSWORD_RULE, {
    message: 'Password must be at least 8 characters and include a letter and a number',
  })
  @MaxLength(200)
  password: string;
}

export class BootstrapDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
