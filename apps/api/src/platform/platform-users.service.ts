import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAuditService } from '../common/audit/platform-audit.service';
import { CreatePlatformUserDto } from './dto/create-platform-user.dto';

/**
 * Plain CRUD over PlatformUser - no granular roles/permissions yet (deferred:
 * every platform user has full access, matching PlatformAuthGuard's own
 * "a valid active PlatformUser is the whole check" stance). This is the entire
 * "Platform users" screen; a permission editor is a separate, larger feature.
 */
@Injectable()
export class PlatformUsersService {
  constructor(
    private prisma: PrismaService,
    private audit: PlatformAuditService,
  ) {}

  private toDto(u: { id: string; email: string; fullName: string; isActive: boolean; createdAt: Date; lastLoginAt: Date | null }) {
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      isActive: u.isActive,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    };
  }

  async list() {
    const rows = await this.prisma.platformUser.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.toDto(r));
  }

  async create(actingPlatformUserId: string, dto: CreatePlatformUserDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.platformUser.findUnique({ where: { email } });
    if (existing) throw new ConflictException({ message: 'A platform user with this email already exists', code: 'EMAIL_IN_USE' });

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const created = await this.prisma.platformUser.create({
      data: { email, fullName: dto.fullName, passwordHash },
    });
    await this.audit.record({
      platformUserId: actingPlatformUserId,
      action: 'CREATE',
      entityType: 'PlatformUser',
      entityId: created.id,
      metadata: { email: created.email },
    });
    return this.toDto(created);
  }

  async setActive(actingPlatformUserId: string, id: string, isActive: boolean) {
    if (id === actingPlatformUserId && !isActive) {
      throw new ConflictException('You cannot deactivate your own platform account');
    }
    const existing = await this.prisma.platformUser.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Platform user not found');

    const updated = await this.prisma.platformUser.update({ where: { id }, data: { isActive } });
    await this.audit.record({
      platformUserId: actingPlatformUserId,
      action: isActive ? 'REACTIVATE' : 'DEACTIVATE',
      entityType: 'PlatformUser',
      entityId: id,
      metadata: { email: existing.email },
    });
    return this.toDto(updated);
  }
}
