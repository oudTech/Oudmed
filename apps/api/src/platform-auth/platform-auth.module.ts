import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformJwtStrategy } from './platform-jwt.strategy';
import { PlatformAuthGuard } from './platform-auth.guard';

@Module({
  imports: [PassportModule, JwtModule.register({ secret: process.env.JWT_SECRET }), PrismaModule],
  controllers: [PlatformAuthController],
  providers: [PlatformAuthService, PlatformJwtStrategy, PlatformAuthGuard],
  exports: [PlatformAuthGuard],
})
export class PlatformAuthModule {}
