import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { OrderStatus, OrderType } from '@prisma/client';

export class UpsertNoteDto {
  @IsOptional() @IsString() @MaxLength(5000) subjective?: string;
  @IsOptional() @IsString() @MaxLength(5000) objective?: string;
  @IsOptional() @IsString() @MaxLength(5000) assessment?: string;
  @IsOptional() @IsString() @MaxLength(5000) plan?: string;
}

export class CreateOrderDto {
  @IsIn(Object.values(OrderType)) orderType: OrderType;
  @IsOptional() @IsUUID() serviceItemId?: string;
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  // Trusted only as an override candidate for actors with billing:manage, and
  // only with overrideReason set - see EncountersService.createOrder. Everyone
  // else's order is priced from the service catalogue regardless of this.
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
  @IsOptional() @IsString() @MaxLength(300) overrideReason?: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @IsOptional() @IsIn(['Routine', 'Urgent', 'STAT']) priority?: string;
  @IsOptional() @IsString() @MaxLength(1000) clinicalNote?: string;
}

export class UpdateOrderDto {
  @IsOptional() @IsIn(Object.values(OrderStatus)) status?: OrderStatus;
  @IsOptional() @IsString() @MaxLength(200) resultValue?: string;
  @IsOptional() @IsString() @MaxLength(40) resultUnit?: string;
  @IsOptional() @IsString() @MaxLength(80) referenceRange?: string;
  @IsOptional() @IsIn(['Normal', 'Low', 'High', 'Critical']) abnormalFlag?: string;
  @IsOptional() @IsString() @MaxLength(2000) resultNote?: string;
}
