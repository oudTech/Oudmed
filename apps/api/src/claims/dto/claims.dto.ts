import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ShortfallAction } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ClaimListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() providerId?: string;
  @IsOptional() @IsString() batchId?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;
}

export class EligibleVisitsQueryDto {
  @IsOptional() @IsString() providerId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

export class GenerateClaimsDto {
  @IsArray() @IsString({ each: true }) visitIds: string[];
}

export class ClaimLineDto {
  @IsOptional() @IsString() invoiceLineId?: string | null;
  @IsOptional() @IsString() serviceCode?: string | null;
  @Transform(trim) @IsString() @MinLength(1) description: string;
  @IsOptional() @IsString() diagnosisCode?: string | null;
  @IsInt() @Min(1) quantity: number;
  @IsNumber() @Min(0) unitPrice: number;
  @IsNumber() @Min(0) claimedAmount: number;
  @IsOptional() @IsBoolean() covered?: boolean;
}

export class CreateClaimDto {
  @IsString() patientId: string;
  @IsString() providerId: string;
  @IsOptional() @IsString() visitId?: string;
  @IsOptional() @IsString() invoiceId?: string;
  @Transform(trim) @IsString() @MinLength(1) memberName: string;
  @Transform(trim) @IsString() @MinLength(1) memberNumber: string;
  @IsOptional() @IsString() authCode?: string;
  @IsISO8601() serviceDate: string;
  @IsOptional() @IsString() diagnosisCode?: string;
  @IsOptional() @IsString() diagnosisSummary?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ClaimLineDto) lines: ClaimLineDto[];
}

export class UpdateClaimDto {
  @IsOptional() @Transform(trim) @IsString() memberName?: string;
  @IsOptional() @Transform(trim) @IsString() memberNumber?: string;
  @IsOptional() @IsString() authCode?: string;
  @IsOptional() @IsISO8601() serviceDate?: string;
  @IsOptional() @IsString() diagnosisCode?: string;
  @IsOptional() @IsString() diagnosisSummary?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ClaimLineDto) lines?: ClaimLineDto[];
}

export class SubmitClaimDto {
  @IsOptional() @IsString() batchId?: string;
}

export class ReasonDto {
  @Transform(trim) @IsString() @MinLength(2) reason: string;
}

export class CreateBatchDto {
  @IsString() providerId: string;
  @IsISO8601() periodStart: string;
  @IsISO8601() periodEnd: string;
  @IsOptional() @IsArray() @IsString({ each: true }) claimIds?: string[];
  @IsOptional() @IsString() notes?: string;
}

export class BatchClaimsDto {
  @IsArray() @IsString({ each: true }) claimIds: string[];
}

export class SubmitBatchDto {
  @IsOptional() @IsString() submissionRef?: string;
}

export class RemittanceAllocationDto {
  @IsString() claimId: string;
  @IsNumber() @Min(0) approvedAmount: number;
  @IsNumber() @Min(0) paidAmount: number;
  @IsOptional() @IsEnum(ShortfallAction) shortfallAction?: ShortfallAction;
  @IsOptional() @IsString() note?: string;
}

export class CreateRemittanceDto {
  @IsString() providerId: string;
  @IsOptional() @IsString() batchId?: string;
  @IsNumber() @Min(0) receivedAmount: number;
  @IsOptional() @IsString() reference?: string;
  @IsISO8601() receivedAt: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RemittanceAllocationDto)
  allocations: RemittanceAllocationDto[];
}

export class OpenClaimsQueryDto {
  @IsString() providerId: string;
  @IsOptional() @IsString() batchId?: string;
}

export class ListQueryDto {
  @IsOptional() @IsString() providerId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;
}
