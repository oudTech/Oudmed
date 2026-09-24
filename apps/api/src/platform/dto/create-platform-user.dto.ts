import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreatePlatformUserDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) fullName: string;
  @Transform(trim) @IsEmail() email: string;
  @IsString() @MinLength(12) @MaxLength(72) password: string;
}
