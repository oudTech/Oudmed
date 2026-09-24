import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { TokensService } from './tokens.service';
import { EmailService } from '../email/email.service';
import { FilesService } from '../storage/files.service';
import { AuditService } from '../common/audit/audit.service';
import { tenantUrl } from '../common/urls';
import type {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const TICKET_TTL_MS = 2 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const codeExpiry = () => new Date(Date.now() + CODE_TTL_MS);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly email: EmailService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── new-clinic sign-up (apex) ─────────────────────────

  async register(dto: RegisterDto) {
    if (!dto.acceptedTerms) {
      throw new BadRequestException('You must accept the Terms of Service and Privacy Policy');
    }
    // Clear any earlier unfinished attempt for this address.
    await this.prisma.pendingRegistration.deleteMany({ where: { email: dto.email } });

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const { code, codeHash } = await this.newCode();
    const pending = await this.prisma.pendingRegistration.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        codeHash,
        expiresAt: codeExpiry(),
      },
    });
    await this.email.sendVerificationCode(pending.email, pending.fullName, code);
    return { pendingToken: this.tokens.issuePending(pending), email: pending.email };
  }

  async resendRegistration(dto: ResendVerificationDto) {
    const pending = await this.pendingFromToken(dto.pendingToken);
    if (pending.verifiedAt) return { ok: true };
    if (Date.now() - pending.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new HttpException(
        { message: 'Please wait a minute before requesting another code', code: 'RESEND_COOLDOWN' },
        429,
      );
    }
    const { code, codeHash } = await this.newCode();
    await this.prisma.pendingRegistration.update({
      where: { id: pending.id },
      data: { codeHash, expiresAt: codeExpiry(), attempts: 0, lastSentAt: new Date() },
    });
    await this.email.sendVerificationCode(pending.email, pending.fullName, code);
    return { ok: true };
  }

  async verifyRegistration(dto: VerifyEmailDto) {
    const pending = await this.pendingFromToken(dto.pendingToken);
    if (pending.verifiedAt) {
      return { pendingToken: this.tokens.issuePending(pending), email: pending.email, verified: true };
    }
    if (pending.expiresAt < new Date()) {
      throw new BadRequestException({ message: 'That code has expired. Request a new one.', code: 'CODE_EXPIRED' });
    }
    if (pending.attempts >= MAX_CODE_ATTEMPTS) {
      throw new BadRequestException({ message: 'Too many attempts. Request a new code.', code: 'TOO_MANY_ATTEMPTS' });
    }
    const ok = await bcrypt.compare(dto.code, pending.codeHash);
    if (!ok) {
      await this.prisma.pendingRegistration.update({
        where: { id: pending.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException({ message: 'Incorrect code', code: 'INVALID_CODE' });
    }
    const updated = await this.prisma.pendingRegistration.update({
      where: { id: pending.id },
      data: { verifiedAt: new Date() },
    });
    return { pendingToken: this.tokens.issuePending(updated), email: updated.email, verified: true };
  }

  private async pendingFromToken(token: string) {
    const claims = this.tokens.verify(token, 'pending');
    const pending = await this.prisma.pendingRegistration.findUnique({ where: { id: claims.sub } });
    if (!pending) {
      throw new BadRequestException({
        message: 'This sign-up session has expired. Please start again.',
        code: 'PENDING_NOT_FOUND',
      });
    }
    return pending;
  }

  // ───────────────────────── cross-domain handoff ─────────────────────────

  /** Mint a one-time ticket for the apex → subdomain session handoff. */
  async issueTicket(userId: string, tenantId: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.authTicket.create({
      data: { tokenHash: sha256(raw), userId, tenantId, expiresAt: new Date(Date.now() + TICKET_TTL_MS) },
    });
    return raw;
  }

  async redeemTicket(raw: string) {
    const ticket = await this.prisma.authTicket.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!ticket || ticket.usedAt || ticket.expiresAt < new Date()) {
      throw new UnauthorizedException({
        message: 'This sign-in link is invalid or has expired',
        code: 'TICKET_INVALID',
      });
    }
    await this.prisma.authTicket.update({ where: { id: ticket.id }, data: { usedAt: new Date() } });
    await this.prisma.user.update({ where: { id: ticket.userId }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      tenantId: ticket.tenantId, userId: ticket.userId,
      action: 'TICKET_REDEEMED', entityType: 'User', entityId: ticket.userId,
    });
    return this.sessionFor(ticket.userId);
  }

  // ───────────────────────── login (subdomain) ─────────────────────────

  async login(dto: LoginDto) {
    const invalid = () =>
      new UnauthorizedException({ message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });

    const tenant = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } });
    if (!tenant || !tenant.isActive) throw invalid();

    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
    });
    const valid =
      user?.passwordHash && user.isActive && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !valid) {
      // tenantId is known even on a failed attempt (the tenant itself resolved
      // above); userId is omitted when the email doesn't match any account, so
      // this never confirms or denies account existence to anyone reading logs.
      await this.audit.record({
        tenantId: tenant.id, userId: user?.id,
        action: 'LOGIN_FAILED', entityType: 'User', entityId: user?.id,
        metadata: { email: dto.email },
      });
      throw invalid();
    }

    if (!user.emailVerifiedAt) {
      await this.issueUserCode(user).catch(() => undefined);
      await this.audit.record({
        tenantId: tenant.id, userId: user.id,
        action: 'LOGIN_BLOCKED_UNVERIFIED', entityType: 'User', entityId: user.id,
      });
      throw new ForbiddenException({
        message: 'Please confirm your email address to continue',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      tenantId: tenant.id, userId: user.id,
      action: 'LOGIN_SUCCESS', entityType: 'User', entityId: user.id,
    });
    return this.sessionFor(user.id);
  }

  async bootstrap(token: string) {
    const claims = this.tokens.verify(token, 'session');
    return this.sessionFor(claims.sub);
  }

  async me(userId: string) {
    return this.sessionFor(userId);
  }

  private async sessionFor(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });
    if (!user || !user.isActive || !user.tenant.isActive) {
      throw new UnauthorizedException('Account not found or inactive');
    }
    return {
      accessToken: this.tokens.issueSession({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
        tenantSlug: user.tenant.slug,
      }),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        avatarUrl: user.avatarUrl,
        emailVerified: !!user.emailVerifiedAt,
      },
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
        logoUrl: await this.files.presignRef(user.tenantId, user.tenant.logoUrl, 600),
        primaryColor: user.tenant.primaryColor,
      },
    };
  }

  // ───────────────────────── password reset (subdomain) ─────────────────────────

  async forgotPassword(dto: ForgotPasswordDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } });
    if (tenant) {
      const user = await this.prisma.user.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
      });
      if (user?.passwordHash) {
        const raw = randomBytes(32).toString('hex');
        await this.prisma.passwordReset.create({
          data: { userId: user.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
        });
        const link = `${tenantUrl(tenant.slug)}/reset-password?token=${encodeURIComponent(raw)}`;
        await this.email.sendPasswordReset(user.email, user.fullName, link).catch(() => undefined);
        await this.audit.record({
          tenantId: tenant.id, userId: user.id,
          action: 'PASSWORD_RESET_REQUESTED', entityType: 'User', entityId: user.id,
        });
      }
    }
    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const pr = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: sha256(dto.token) },
      include: { user: true },
    });
    if (!pr || pr.usedAt || pr.expiresAt < new Date()) {
      throw new BadRequestException({
        message: 'This reset link is invalid or has expired',
        code: 'INVALID_TOKEN',
      });
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: pr.userId },
        data: { passwordHash, emailVerifiedAt: pr.user.emailVerifiedAt ?? new Date() },
      }),
      this.prisma.passwordReset.updateMany({
        where: { userId: pr.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      tenantId: pr.user.tenantId, userId: pr.userId,
      action: 'PASSWORD_RESET_COMPLETED', entityType: 'User', entityId: pr.userId,
    });
    return this.sessionFor(pr.userId);
  }

  // ───────────────────────── helpers ─────────────────────────

  private async newCode() {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    return { code, codeHash: await bcrypt.hash(code, 10) };
  }

  private async issueUserCode(user: { id: string; email: string; fullName: string }) {
    const { code, codeHash } = await this.newCode();
    await this.prisma.emailVerification.upsert({
      where: { userId: user.id },
      create: { userId: user.id, codeHash, expiresAt: codeExpiry() },
      update: { codeHash, expiresAt: codeExpiry(), attempts: 0, lastSentAt: new Date() },
    });
    await this.email.sendVerificationCode(user.email, user.fullName, code);
  }
}
