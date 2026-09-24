import { HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { AuthUser } from '../common/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../subscriptions/entitlements.service';

const READ_ONLY_WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
// A read-only hospital must still be able to log in, see why, and pay to
// unlock - these path prefixes are never blocked regardless of access level.
const ALWAYS_ALLOWED_PREFIXES = ['/api/auth', '/api/subscriptions', '/api/health', '/api/me'];

/**
 * Validates session tokens for the app API. Pending tokens (new-clinic sign-up,
 * pre-tenant) are rejected here; the onboarding endpoint checks them itself.
 *
 * Every request re-checks the user against the database: a deactivated account,
 * a deactivated tenant, or a token whose tenant no longer matches is rejected
 * immediately (not after the 7-day token TTL). The role is read fresh from the
 * DB so role changes take effect at once. Cost is one indexed primary-key lookup.
 *
 * This is also where subscription READ_ONLY access is enforced: `validate()`
 * already has the authenticated request in scope on every call, which is a
 * simpler and safer choke point than a global guard (a global `APP_GUARD`
 * would run *before* this strategy populates `req.user`, so it could never
 * make this check). Reads are never blocked; only a lapsed hospital's writes
 * are, outside the allowlisted paths it needs to see its own status and pay.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: any): Promise<AuthUser> {
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

    // Platform-wide maintenance mode (Super Admin > Settings). Platform
    // operators use a separate strategy entirely and are never affected.
    const config = await this.prisma.platformConfig.findFirst({ select: { maintenanceMode: true } });
    if (config?.maintenanceMode) {
      throw new HttpException(
        {
          statusCode: 503,
          message: 'The platform is temporarily down for maintenance. Please try again shortly.',
          code: 'MAINTENANCE_MODE',
        },
        503,
      );
    }

    if (
      READ_ONLY_WRITE_METHODS.has(req.method) &&
      !ALWAYS_ALLOWED_PREFIXES.some((p) => req.path?.startsWith(p))
    ) {
      const access = await this.entitlements.getAccessLevel(user.tenantId);
      if (access === 'READ_ONLY') {
        throw new HttpException(
          {
            statusCode: 402,
            message: "This hospital's subscription needs attention. Existing records remain viewable; ask your admin to update billing to resume creating or editing records.",
            code: 'SUBSCRIPTION_READ_ONLY',
          },
          402,
        );
      }
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
