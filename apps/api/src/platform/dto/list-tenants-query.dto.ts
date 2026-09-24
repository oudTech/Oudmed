import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class ListTenantsQueryDto {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsIn(['all', 'trialing', 'active', 'past_due', 'suspended']) status?: string;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;
}
