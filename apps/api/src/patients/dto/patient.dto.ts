import {
  IsBoolean,
  IsDateString,
  IsEmail,
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
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  BloodGroup,
  Genotype,
  IdDocumentType,
  MaritalStatus,
  PayerType,
  PregnancyStatus,
  RhFactor,
} from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Personal fields shared by create + update. */
class PersonalFields {
  @Transform(trim) @IsOptional() @IsString() @MaxLength(80) middleName?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
  @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @IsOptional() @IsEnum(MaritalStatus) maritalStatus?: MaritalStatus;
  @IsOptional() @IsString() @MaxLength(60) nationality?: string;
  @IsOptional() @IsString() @MaxLength(80) occupation?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(30) altPhone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @IsString() @MaxLength(2) country?: string;
}

export class CreatePatientDto extends PersonalFields {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) firstName: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) lastName: string;

  // Allow the quick-add path to also set a payer up front.
  @IsOptional() @IsEnum(PayerType) payerType?: PayerType;
  @IsOptional() @IsString() @MaxLength(120) hmoName?: string;
  @IsOptional() @IsString() @MaxLength(60) hmoNumber?: string;
  @IsOptional() @IsUUID() assignedDoctorId?: string;
}

export class UpdatePatientDto extends PersonalFields {
  @Transform(trim) @IsOptional() @IsString() @MinLength(1) @MaxLength(80) firstName?: string;
  @Transform(trim) @IsOptional() @IsString() @MinLength(1) @MaxLength(80) lastName?: string;

  // emergency contact
  @IsOptional() @IsString() @MaxLength(120) emergencyContactName?: string;
  @IsOptional() @IsString() @MaxLength(60) emergencyContactRelationship?: string;
  @IsOptional() @IsString() @MaxLength(30) emergencyContactPhone?: string;
  @IsOptional() @IsString() @MaxLength(30) emergencyContactAltPhone?: string;
  @IsOptional() @IsString() @MaxLength(250) emergencyContactAddress?: string;

  // medical
  @IsOptional() @IsEnum(BloodGroup) bloodGroup?: BloodGroup;
  @IsOptional() @IsEnum(RhFactor) rhFactor?: RhFactor;
  @IsOptional() @IsEnum(Genotype) genotype?: Genotype;
  @IsOptional() @IsString() @MaxLength(1000) allergies?: string;
  @IsOptional() @IsString() @MaxLength(1000) chronicConditions?: string;
  @IsOptional() @IsString() @MaxLength(1000) currentMedications?: string;
  @IsOptional() @IsString() @MaxLength(1000) previousSurgeries?: string;
  @IsOptional() @IsString() @MaxLength(1000) disabilities?: string;
  @IsOptional() @IsEnum(PregnancyStatus) pregnancyStatus?: PregnancyStatus;
  @IsOptional() @IsString() @MaxLength(1000) familyHistory?: string;
  @IsOptional() @IsInt() @Min(20) @Max(280) heightCm?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(700) weightKg?: number;

  // narrative clinical history (Medical background tab)
  @IsOptional() @IsString() @MaxLength(4000) historyPresentingComplaint?: string;
  @IsOptional() @IsString() @MaxLength(4000) pastMedicalHistory?: string;
  @IsOptional() @IsString() @MaxLength(4000) drugHistory?: string;
  @IsOptional() @IsString() @MaxLength(4000) reproductiveHistory?: string;
  @IsOptional() @IsString() @MaxLength(4000) socialHistory?: string;

  // payer & insurance
  @IsOptional() @IsEnum(PayerType) payerType?: PayerType;
  @IsOptional() @IsString() @MaxLength(120) hmoName?: string;
  @IsOptional() @IsString() @MaxLength(60) hmoNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) insuranceProvider?: string;
  @IsOptional() @IsString() @MaxLength(80) insuranceNumber?: string;
  @IsOptional() @IsString() @MaxLength(60) insurancePlanType?: string;
  @IsOptional() @IsString() @MaxLength(120) insuranceEmployer?: string;
  @IsOptional() @IsDateString() insuranceExpiry?: string;

  // identification
  @IsOptional() @IsEnum(IdDocumentType) idDocumentType?: IdDocumentType;
  @IsOptional() @IsString() @MaxLength(60) idDocumentNumber?: string;

  // consent
  @IsOptional() @IsBoolean() consentTreatment?: boolean;
  @IsOptional() @IsBoolean() consentDataProcessing?: boolean;

  // assignment
  @IsOptional() @IsUUID() assignedDoctorId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;

  // wizard progress
  @IsOptional() @IsInt() @Min(2) @Max(8) reachedStep?: number;
  @IsOptional() @IsBoolean() completeRegistration?: boolean;
}

export class ListPatientsQueryDto {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional()
  @IsEnum(['all', 'active', 'inpatient', 'emergency', 'hmo', 'incomplete'] as any)
  filter?: 'all' | 'active' | 'inpatient' | 'emergency' | 'hmo' | 'incomplete';
  @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;
}

export class CheckDuplicatesDto {
  @Transform(trim) @IsOptional() @IsString() firstName?: string;
  @Transform(trim) @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsDateString() dateOfBirth?: string;
}
