import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdatePlatformPricingDto {
  @IsOptional() @IsNumber() @Min(0)
  adminSeatPriceMonthly?: number;

  @IsOptional() @IsNumber() @Min(0)
  otherSeatPriceMonthly?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(100)
  annualDiscountPct?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(100)
  vatPct?: number;

  @IsOptional() @IsString() @MaxLength(40)
  platformTin?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(365)
  trialDays?: number;

  @IsOptional() @IsString() @MaxLength(8)
  currency?: string;
}
