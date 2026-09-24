import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformLoginDto } from './dto/login.dto';

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
}
