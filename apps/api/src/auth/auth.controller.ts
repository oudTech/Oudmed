import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import {
  BootstrapDto,
  ForgotPasswordDto,
  LoginDto,
  RedeemTicketDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('verify-email')
  @Throttle({ default: { limit: 10, ttl: 10 * 60 * 1000 } })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyRegistration(dto);
  }

  @Post('resend-verification')
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.auth.resendRegistration(dto);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('redeem-ticket')
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  redeemTicket(@Body() dto: RedeemTicketDto) {
    return this.auth.redeemTicket(dto.ticket);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Post('bootstrap')
  bootstrap(@Body() dto: BootstrapDto) {
    return this.auth.bootstrap(dto.token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }
}
