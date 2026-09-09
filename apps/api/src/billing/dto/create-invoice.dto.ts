import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PayerType } from '@prisma/client';

export class InvoiceLineDto {
  @IsOptional() @IsString() serviceItemId?: string;
  @IsOptional() @IsString() drugId?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsString() @MaxLength(200) description: string;
  @IsInt() @Min(1) quantity: number;
  @IsNumber() @Min(0) unitPrice: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) discountPct?: number;
}

export class CreateInvoiceDto {
  @IsString() patientId: string;
  @IsOptional() @IsString() visitId?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsEnum(PayerType) payerType?: PayerType;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) invoiceDiscountPct?: number;
  @IsOptional() @IsString() @MaxLength(200) discountReason?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines: InvoiceLineDto[];
}

export class UpdateInvoiceDto {
  @IsOptional() @IsNumber() @Min(0) @Max(100) invoiceDiscountPct?: number;
  @IsOptional() @IsString() @MaxLength(200) discountReason?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
}

export class CancelInvoiceDto {
  @IsString() @MaxLength(300) reason: string;
}

export class ReversePaymentDto {
  @IsString() @MaxLength(300) reason: string;
}
