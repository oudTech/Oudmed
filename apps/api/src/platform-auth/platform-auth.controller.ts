import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PlatformAuthGuard } from './platform-auth.guard';
import { CurrentPlatformUser, PlatformAuthUser } from './current-platform-user.decorator';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformLoginDto } from './dto/login.dto';
import { UpdatePlatformProfileDto } from './dto/update-profile.dto';
import { ChangePlatformPasswordDto } from './dto/change-password.dto';

@ApiTags('platform-auth')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private auth: PlatformAuthService) {}

  // Stricter than the hospital-staff login (10/min) - a compromised platform
  // account reaches across every hospital, not just one.
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @Post('login')
  login(@Body() dto: PlatformLoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  // ── self-service account (Settings > Admin account) ──

  @ApiBearerAuth()
  @UseGuards(PlatformAuthGuard)
  @Get('me')
  me(@CurrentPlatformUser() u: PlatformAuthUser) {
    return this.auth.me(u.platformUserId);
  }

  @ApiBearerAuth()
  @UseGuards(PlatformAuthGuard)
  @Patch('me')
  updateProfile(@CurrentPlatformUser() u: PlatformAuthUser, @Body() dto: UpdatePlatformProfileDto) {
    return this.auth.updateProfile(u.platformUserId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(PlatformAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @Patch('me/password')
  async changePassword(@CurrentPlatformUser() u: PlatformAuthUser, @Body() dto: ChangePlatformPasswordDto) {
    await this.auth.changePassword(u.platformUserId, dto);
    return { ok: true };
  }
}
