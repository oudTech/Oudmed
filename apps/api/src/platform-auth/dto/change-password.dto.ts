import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePlatformPasswordDto {
  @IsString() currentPassword: string;

  // 12+, same posture as CreatePlatformUserDto - a compromised platform
  // account reaches across every hospital, not just one.
  @IsString() @MinLength(12) @MaxLength(72) newPassword: string;
}
