import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';
import { AdmissionStatus, AdmissionType, PayerType } from '@prisma/client';

export class ListAdmissionsQueryDto {
  @IsOptional() @IsEnum(AdmissionStatus) status?: AdmissionStatus;
  @IsOptional() @IsUUID() wardId?: string;
}

export class CreateAdmissionDto {
  @IsUUID() patientId: string;

  @IsOptional() @IsUUID() admittingDoctorId?: string;
  @IsOptional() @IsUUID() attendingDoctorId?: string;
  @IsOptional() @IsUUID() departmentId?: string;

  @IsUUID() wardId: string;
  @IsUUID() bedId: string;

  @IsEnum(AdmissionType) admissionType: AdmissionType;

  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @MaxLength(500) provisionalDiagnosis?: string;

  @IsOptional() @IsEnum(PayerType) payerType?: PayerType;
  @IsOptional() @IsString() @MaxLength(120) hmoName?: string;
  @IsOptional() @IsString() @MaxLength(60) authCode?: string;

  @IsOptional() @IsDateString() expectedDischargeAt?: string;
  @IsOptional() @IsUUID() originatingVisitId?: string;
}

export class CreateDepositDto {
  @IsNumber() @Min(0.01) amount: number;
  // Constrained to Payment.method's own enum values, not just any string - a
  // deposit can become a real Payment (apply-deposit/discharge auto-apply),
  // and that insert fails at the DB level if the value isn't one of these.
  @IsIn(['CASH', 'CARD', 'TRANSFER']) method: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
}

export class RefundDepositDto {
  @IsNumber() @Min(0.01) amount: number;
  @IsString() @MaxLength(300) reason: string;
}

export class TransferAdmissionDto {
  @IsUUID() bedId: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class DischargeAdmissionDto {
  @IsOptional()
  @IsEnum(AdmissionStatus)
  status?: AdmissionStatus; // DISCHARGED (default) | DECEASED | TRANSFERRED_OUT | ABSCONDED

  @IsOptional() @IsString() @MaxLength(2000) dischargeNotes?: string;

  // Required only when Tenant.requireSettledBillAtDischarge is on and a
  // balance remains after deposit credit is auto-applied - HOSPITAL_ADMIN
  // only (admission:discharge-unsettled), audited.
  @IsOptional() @IsString() @MaxLength(500) overrideReason?: string;

  // Optional: if deposit credit remains after auto-apply, discharge still
  // completes regardless (it is never blocked on a refund) - but giving
  // these pays it out immediately instead of leaving it a pending refund.
  @IsOptional() @IsIn(['CASH', 'CARD', 'TRANSFER']) refundMethod?: string;
  @IsOptional() @IsString() @MaxLength(120) refundReference?: string;
}

export class ApplyDepositDto {
  @IsNumber() @Min(0.01) amount: number;
}

export class PayRefundDto {
  @IsIn(['CASH', 'CARD', 'TRANSFER']) method: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
}

export class ReopenAdmissionDto {
  @IsString() @MaxLength(500) reason: string;
}

export class UpdateAdmissionDto {
  @IsOptional() @IsUUID() attendingDoctorId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsString() @MaxLength(500) provisionalDiagnosis?: string;
  @IsOptional() @IsEnum(PayerType) payerType?: PayerType;
  @IsOptional() @IsString() @MaxLength(120) hmoName?: string;
  @IsOptional() @IsString() @MaxLength(60) authCode?: string;
  @IsOptional() @IsDateString() expectedDischargeAt?: string;
}
