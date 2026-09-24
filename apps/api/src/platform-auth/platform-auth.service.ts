import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAuditService } from '../common/audit/platform-audit.service';
import { UpdatePlatformProfileDto } from './dto/update-profile.dto';
import { ChangePlatformPasswordDto } from './dto/change-password.dto';

@Injectable()
export class PlatformAuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: PlatformAuditService,
  ) {}

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.prisma.platformUser.findUnique({ where: { email: email.toLowerCase().trim() } });
    const valid = user?.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.platformUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const accessToken = this.jwt.sign(
      { sub: user.id, typ: 'platform', email: user.email, fullName: user.fullName },
      { expiresIn: '7d' as any },
    );
    return { accessToken };
  }

  // ── self-service account (Settings > Admin account) ──

  private async mustFind(platformUserId: string) {
    const user = await this.prisma.platformUser.findUnique({ where: { id: platformUserId } });
    if (!user) throw new NotFoundException('Platform user not found');
    return user;
  }

  async me(platformUserId: string) {
    const u = await this.mustFind(platformUserId);
    return { id: u.id, email: u.email, fullName: u.fullName };
  }

  async updateProfile(platformUserId: string, dto: UpdatePlatformProfileDto) {
    await this.mustFind(platformUserId);
    const updated = await this.prisma.platformUser.update({
      where: { id: platformUserId },
      data: { fullName: dto.fullName },
    });
    await this.audit.record({
      platformUserId,
      action: 'UPDATE_PROFILE',
      entityType: 'PlatformUser',
      entityId: platformUserId,
    });
    return { id: updated.id, email: updated.email, fullName: updated.fullName };
  }

  async changePassword(platformUserId: string, dto: ChangePlatformPasswordDto): Promise<void> {
    const user = await this.mustFind(platformUserId);
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.platformUser.update({ where: { id: platformUserId }, data: { passwordHash } });
    await this.audit.record({
      platformUserId,
      action: 'CHANGE_PASSWORD',
      entityType: 'PlatformUser',
      entityId: platformUserId,
    });
  }
}
