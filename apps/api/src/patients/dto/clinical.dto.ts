import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ComplaintStatus, DiagnosisCertainty, PrescriptionStatus } from '@prisma/client';

export class CreateComplaintDto {
  @IsString() @MinLength(2) @MaxLength(500) description: string;
  @IsOptional() @IsString() @MaxLength(300) onsetNote?: string;
  @IsOptional() @IsString() @MaxLength(20) severity?: string; // Mild | Moderate | Severe
  @IsOptional() @IsUUID() visitId?: string;
}

export class UpdateComplaintDto {
  @IsOptional() @IsEnum(ComplaintStatus) status?: ComplaintStatus;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(20) severity?: string;
}

export class CreateDiagnosisDto {
  @IsString() @MinLength(2) @MaxLength(300) description: string;
  @IsOptional() @IsString() @MaxLength(20) code?: string;
  @IsOptional() @IsEnum(DiagnosisCertainty) certainty?: DiagnosisCertainty;
  @IsOptional() @IsString() @MaxLength(60) attendanceType?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsUUID() visitId?: string;
  @IsOptional() @IsUUID() admissionId?: string;
}

export class CreateVitalsDto {
  @IsOptional() @IsNumber() @Min(25) @Max(45) temperatureC?: number;
  @IsOptional() @IsInt() @Min(20) @Max(300) pulseBpm?: number;
  @IsOptional() @IsInt() @Min(4) @Max(80) respiratoryRate?: number;
  @IsOptional() @IsInt() @Min(40) @Max(300) systolicBp?: number;
  @IsOptional() @IsInt() @Min(20) @Max(200) diastolicBp?: number;
  @IsOptional() @IsInt() @Min(50) @Max(100) spo2?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(700) weightKg?: number;
  @IsOptional() @IsInt() @Min(20) @Max(280) heightCm?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(60) bloodGlucose?: number;
  @IsOptional() @IsInt() @Min(0) @Max(20000) urineOutputMl?: number;
  @IsOptional() @IsString() @MaxLength(2) avpu?: string; // A | V | P | U
  @IsOptional() @IsInt() @Min(0) @Max(10) painScore?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsUUID() visitId?: string;
  @IsOptional() @IsUUID() admissionId?: string;
}

class RxItemDto {
  @IsOptional() @IsUUID() drugId?: string;
  @IsString() @MinLength(1) @MaxLength(120) drugName: string;
  @IsOptional() @IsString() @MaxLength(40) dosageForm?: string;
  @IsOptional() @IsString() @MaxLength(40) strengthConc?: string;
  @IsOptional() @IsString() @MaxLength(40) amountPerUse?: string;
  @IsOptional() @IsString() @MaxLength(40) frequency?: string;
  @IsOptional() @IsString() @MaxLength(40) route?: string;
  @IsOptional() @IsString() @MaxLength(40) foodRelation?: string;
  @IsOptional() @IsString() @MaxLength(10) durationType?: string;
  @IsOptional() @IsInt() @Min(1) @Max(365) durationNumber?: number;
  @IsOptional() @IsString() @MaxLength(300) instructions?: string;
}

export class CreatePrescriptionDto {
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsUUID() visitId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => RxItemDto)
  items: RxItemDto[];
}

export class UpdatePrescriptionDto {
  @IsEnum(PrescriptionStatus) status: PrescriptionStatus;
}
