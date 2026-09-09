import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export type TokenType = 'pending' | 'session';

export interface PendingClaims {
  sub: string; // PendingRegistration id
  typ: 'pending';
  email: string;
}

export interface SessionClaims {
  sub: string; // User id
  typ: 'session';
  tenantId: string;
  tenantSlug: string;
  role: string;
  email: string;
  fullName: string;
}

export type AnyClaims = PendingClaims | SessionClaims;

// `as any` on expiresIn: @nestjs/jwt's re-exported StringValue type rejects
// plain string literals in strict mode (a known upstream types quirk).
const TTL = {
  pending: '30m',
  session: '7d',
} as const;

@Injectable()
export class TokensService {
  constructor(private readonly jwt: JwtService) {}

  issuePending(pending: { id: string; email: string }): string {
    return this.jwt.sign(
      { sub: pending.id, typ: 'pending', email: pending.email },
      { expiresIn: TTL.pending as any },
    );
  }

  issueSession(user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    tenantId: string;
    tenantSlug: string;
  }): string {
    return this.jwt.sign(
      {
        sub: user.id,
        typ: 'session',
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
        tenantSlug: user.tenantSlug,
      },
      { expiresIn: TTL.session as any },
    );
  }

  verify<T extends AnyClaims = AnyClaims>(token: string, expected?: TokenType): T {
    let claims: T;
    try {
      claims = this.jwt.verify<T>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (expected && claims.typ !== expected) {
      throw new UnauthorizedException(`Expected a ${expected} token`);
    }
    return claims;
  }
}
