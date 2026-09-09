import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { TokensService } from '../auth/tokens.service';
import { tenantUrl } from '../common/urls';
import { CreateTenantDto } from './dto/create-tenant.dto';

const RESERVED_SLUGS = new Set([
  'www', 'app', 'api', 'admin', 'dashboard', 'auth', 'login', 'signup',
  'account', 'billing', 'support', 'help', 'status', 'mail', 'static', 'assets',
  'oudmed', 'onboarding', 'verify-email',
]);

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
  ) {}

  /**
   * Onboarding step: turn a verified PendingRegistration into a real Tenant +
   * HOSPITAL_ADMIN User, then return the one-time subdomain handoff URL.
   */
  async createFromPending(pendingToken: string, dto: CreateTenantDto) {
    const claims = this.tokens.verify(pendingToken, 'pending');
    const pending = await this.prisma.pendingRegistration.findUnique({ where: { id: claims.sub } });
    if (!pending) {
      throw new BadRequestException({
        message: 'This sign-up session has expired. Please start again.',
        code: 'PENDING_NOT_FOUND',
      });
    }
    if (!pending.verifiedAt) {
      throw new BadRequestException({
        message: 'Confirm your email address before creating a workspace',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const slug = await this.generateSlug(dto.name);

    const { tenant, user } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug,
          facilityType: dto.facilityType,
          country: dto.country,
          staffSizeBand: dto.staffSizeBand,
          contactEmail: pending.email,
        },
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: pending.email,
          passwordHash: pending.passwordHash,
          fullName: pending.fullName,
          role: 'HOSPITAL_ADMIN',
          emailVerifiedAt: pending.verifiedAt ?? new Date(),
        },
      });
      await tx.pendingRegistration.delete({ where: { id: pending.id } });
      return { tenant, user };
    });

    const ticket = await this.auth.issueTicket(user.id, tenant.id);
    return {
      tenant: { slug: tenant.slug, name: tenant.name },
      redirectUrl: `${tenantUrl(tenant.slug)}/auth/callback?ticket=${encodeURIComponent(ticket)}`,
    };
  }

  async checkSlug(slug: string) {
    const normalized = slugify(slug);
    if (!normalized || normalized.length < 3) {
      return { available: false, reason: 'too_short', slug: normalized };
    }
    if (RESERVED_SLUGS.has(normalized)) {
      return { available: false, reason: 'reserved', slug: normalized };
    }
    const existing = await this.prisma.tenant.findUnique({ where: { slug: normalized } });
    return { available: !existing, slug: normalized };
  }

  async resolvePublic(identifier: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: {
        OR: [{ slug: identifier.toLowerCase() }, { customDomain: identifier.toLowerCase() }],
        isActive: true,
      },
      select: { id: true, name: true, slug: true, logoUrl: true, primaryColor: true },
    });
    if (!tenant) throw new NotFoundException('Workspace not found');
    return tenant;
  }

  private async generateSlug(name: string): Promise<string> {
    const base = slugify(name) || 'clinic';
    let candidate = RESERVED_SLUGS.has(base) ? `${base}-clinic` : base;
    for (let i = 0; i < 50; i++) {
      const taken = await this.prisma.tenant.findUnique({ where: { slug: candidate } });
      if (!taken) return candidate;
      candidate = `${base}-${i + 2}`;
    }
    throw new ConflictException('Could not generate an available workspace address');
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
