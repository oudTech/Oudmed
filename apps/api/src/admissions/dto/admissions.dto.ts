import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
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
