import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class OnboardingStateDto {
  @IsOptional() @IsIn(['not_started', 'in_progress', 'completed', 'skipped'])
  status?: string;

  @IsOptional() @IsString() @MaxLength(80)
  currentTour?: string | null;

  @IsOptional() @IsInt() @Min(0)
  currentStep?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  completedTours?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  skippedTours?: string[];
}

/** Only these keys are writable; `onboarding` is deep-merged into what's stored. */
export class UpdatePreferencesDto {
  @IsOptional() @ValidateNested() @Type(() => OnboardingStateDto)
  onboarding?: OnboardingStateDto;

  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true })
  seenFeatures?: string[];
}
