import { IsEnum, IsNumber, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';
import { PaymentMethod, PayerType } from '@prisma/client';

export class CreatePaymentDto {
  @IsNumber() @Min(1)
  amount: number;

  /** Client-generated per-attempt key so a retried submit does not double-pay. */
  @IsOptional() @IsString() @Length(8, 64)
  idempotencyKey?: string;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsOptional() @IsEnum(PayerType)
  payerType?: PayerType;

  @IsOptional() @IsString() @MaxLength(120)
  payerName?: string;

  @IsOptional() @IsString() @MaxLength(80)
  reference?: string;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}
