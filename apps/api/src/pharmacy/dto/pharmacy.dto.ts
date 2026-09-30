import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class DispenseItemDto {
  @IsUUID() itemId: string;
  @IsInt() @Min(0) quantity: number;
  // Trusted only as an override candidate for actors with billing:manage, and
  // only with overrideReason set - see PharmacyService.dispense. Everyone
  // else's dispense is priced from the drug catalogue regardless of this.
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
  @IsOptional() @IsString() @MaxLength(300) overrideReason?: string;
}

export class DispenseDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DispenseItemDto)
  items: DispenseItemDto[];

  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
