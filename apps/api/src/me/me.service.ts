import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePreferencesDto } from './dto/preferences.dto';

const MAX_BYTES = 8_000;

/**
 * Self-service user preferences. Every method is scoped to the authenticated
 * user's own id (from the JWT), so there is no `assertCan` - a user can only
 * ever read or write their own row. `User` is not an RLS table; these queries
 * are keyed by the verified `userId`, the same pattern the auth / staff services
 * already use.
 */
@Injectable()
export class MeService {
  constructor(private prisma: PrismaService) {}

  async getPreferences(userId: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    return (user?.preferences as Record<string, unknown> | null) ?? {};
  }

  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<Record<string, unknown>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    const current = (user?.preferences as Record<string, unknown> | null) ?? {};
    const next: Record<string, unknown> = { ...current };

    if (dto.onboarding !== undefined) {
      next.onboarding = {
        ...((current.onboarding as Record<string, unknown> | undefined) ?? {}),
        ...dto.onboarding,
      };
    }
    if (dto.seenFeatures !== undefined) {
      next.seenFeatures = [...new Set(dto.seenFeatures)];
    }

    if (JSON.stringify(next).length > MAX_BYTES) {
      throw new BadRequestException('Preferences payload is too large');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { preferences: next as Prisma.InputJsonValue },
    });
    return next;
  }
}
