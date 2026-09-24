import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';
import { AuthController } from './auth.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET }),
    PrismaModule,
    SubscriptionsModule,
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, AuthService, TokensService],
  exports: [AuthService, TokensService, JwtModule],
})
export class AuthModule {}
