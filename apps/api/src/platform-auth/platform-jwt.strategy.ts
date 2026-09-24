import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAuthUser } from './current-platform-user.decorator';

/**
 * A separate Passport strategy from the hospital-staff JwtStrategy, registered
 * under its own name ('platform-jwt') so the two never collide or get mixed
 * up - a hospital session token must never be accepted here, and vice versa.
 * Same defense-in-depth principle as the staff strategy: re-checks
 * PlatformUser.isActive from the database on every request, not just at
 * token-issue time.
 */
@Injectable()
export class PlatformJwtStrategy extends PassportStrategy(Strategy, 'platform-jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  async validate(payload: any): Promise<PlatformAuthUser> {
    if (payload.typ !== 'platform') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.prisma.platformUser.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true, email: true, fullName: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    return { platformUserId: user.id, email: user.email, fullName: user.fullName };
  }
}
