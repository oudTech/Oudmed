import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../common/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Validates session tokens for the app API. Pending tokens (new-clinic sign-up,
 * pre-tenant) are rejected here; the onboarding endpoint checks them itself.
 *
 * Every request re-checks the user against the database: a deactivated account,
 * a deactivated tenant, or a token whose tenant no longer matches is rejected
 * immediately (not after the 7-day token TTL). The role is read fresh from the
 * DB so role changes take effect at once. Cost is one indexed primary-key lookup.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  async validate(payload: any): Promise<AuthUser> {
    if (payload.typ !== 'session') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        isActive: true,
        tenantId: true,
        tenant: { select: { isActive: true } },
      },
    });

    if (
      !user ||
      !user.isActive ||
      !user.tenant.isActive ||
      user.tenantId !== payload.tenantId
    ) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    return {
      userId: payload.sub,
      tenantId: user.tenantId,
      tenantSlug: payload.tenantSlug,
      role: user.role,
      email: payload.email,
      fullName: payload.fullName,
    };
  }
}
