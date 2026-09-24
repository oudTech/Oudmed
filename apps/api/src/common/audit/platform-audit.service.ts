import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Durable cross-tenant audit trail for platform-operator actions - see the
 * PlatformAuditLog schema comment. SubscriptionsService has its own private
 * equivalent for pricing/mark-paid; this shared version is for the rest of the
 * platform module (tenant lifecycle, platform config, platform users) so that
 * logic isn't duplicated a second time.
 */
@Injectable()
export class PlatformAuditService {
  constructor(private prisma: PrismaService) {}

  async record(entry: {
    platformUserId?: string;
    tenantId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.platformAuditLog.create({
      data: {
        platformUserId: entry.platformUserId,
        tenantId: entry.tenantId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata as Prisma.InputJsonValue,
      },
    });
  }
}
