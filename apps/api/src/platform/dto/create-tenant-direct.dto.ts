import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * A platform operator creating a hospital directly - skips the self-serve
 * email-verification flow entirely (the operator vouches for the account), but
 * still starts a real trial via SubscriptionsService.startTrial, same as
 * TenantsService.createFromPending does for a self-serve sign-up.
 */
export class CreateTenantDirectDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(250) address?: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) adminFullName: string;
  @Transform(trim) @IsEmail() adminEmail: string;
  @IsString() @MinLength(8) @MaxLength(72) adminPassword: string;
}
