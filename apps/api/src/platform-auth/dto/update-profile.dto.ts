import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdatePlatformProfileDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) fullName: string;
}
