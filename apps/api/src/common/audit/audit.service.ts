import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * Append-only audit write. Runs outside any forTenant transaction (it is called
   * mid-transaction from billing/claims, where a nested forTenant would risk a
   * hang), so it uses a raw INSERT with no RETURNING: the AuditLog INSERT policy
   * is permissive, and skipping RETURNING avoids the SELECT policy check.
   */
  async record(params: {
    tenantId: string;
    userId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const metadata = params.metadata ? JSON.stringify(params.metadata) : null;
    await this.prisma.$executeRaw`
      INSERT INTO "AuditLog" ("id", "tenantId", "userId", "action", "entityType", "entityId", "metadata", "createdAt")
      VALUES (
        gen_random_uuid(),
        ${params.tenantId},
        ${params.userId ?? null},
        ${params.action},
        ${params.entityType},
        ${params.entityId ?? null},
        ${metadata}::jsonb,
        now()
      )
    `;
  }
}
