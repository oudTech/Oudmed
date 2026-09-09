import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PayerType, VisitStatus, VisitType } from '@prisma/client';

export class ListVisitsQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() doctorId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsEnum(VisitStatus) status?: VisitStatus;
}

export class CreateVisitDto {
  @IsUUID() patientId: string;

  @IsOptional() @IsUUID() doctorId?: string;
  @IsOptional() @IsUUID() departmentId?: string;

  @IsDateString() startsAt: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsInt() @Min(5) @Max(480) durationMinutes?: number;

  @IsOptional() @IsEnum(VisitType) visitType?: VisitType;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @MaxLength(60) roomLabel?: string;

  @IsOptional() @IsEnum(PayerType) payerType?: PayerType;
  @IsOptional() @IsString() @MaxLength(120) hmoName?: string;
  @IsOptional() @IsString() @MaxLength(60) authCode?: string;

  /** Book anyway despite a doctor time-clash. */
  @IsOptional() @IsBoolean() force?: boolean;
}

export class RescheduleVisitDto {
  @IsDateString() startsAt: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsInt() @Min(5) @Max(480) durationMinutes?: number;
  @IsOptional() @IsUUID() doctorId?: string;
  @IsOptional() @IsBoolean() force?: boolean;
}

export class UpdateVisitDto {
  @IsOptional() @IsUUID() doctorId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsEnum(VisitType) visitType?: VisitType;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @MaxLength(60) roomLabel?: string;
  @IsOptional() @IsEnum(PayerType) payerType?: PayerType;
  @IsOptional() @IsString() @MaxLength(120) hmoName?: string;
  @IsOptional() @IsString() @MaxLength(60) authCode?: string;
}

export class SetVisitStatusDto {
  @IsEnum(VisitStatus) status: VisitStatus;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
