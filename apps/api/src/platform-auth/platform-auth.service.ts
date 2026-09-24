import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlatformAuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
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
}
