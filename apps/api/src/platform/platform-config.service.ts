import { Injectable, NotFoundException } from '@nestjs/common';
import type { PlatformConfigDTO } from '@oudhealth/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAuditService } from '../common/audit/platform-audit.service';
import { UpdatePlatformConfigDto } from './dto/update-platform-config.dto';

type ConfigRow = {
  id: string;
  platformName: string;
  supportEmail: string | null;
  supportPhone: string | null;
  supportHours: string | null;
  logoUrl: string | null;
  defaultCountry: string;
  defaultCurrency: string;
  timeFormat: string;
  maintenanceMode: boolean;
};

/** Same singleton-row pattern as SubscriptionsService's PlatformPricing handling. */
@Injectable()
export class PlatformConfigService {
  constructor(
    private prisma: PrismaService,
    private audit: PlatformAuditService,
  ) {}

  private async row(): Promise<ConfigRow> {
    const row = await this.prisma.platformConfig.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!row) throw new NotFoundException('Platform configuration has not been initialized');
    return row;
  }

  private toDto(row: ConfigRow): PlatformConfigDTO {
    return {
      platformName: row.platformName,
      supportEmail: row.supportEmail,
      supportPhone: row.supportPhone,
      supportHours: row.supportHours,
      logoUrl: row.logoUrl,
      defaultCountry: row.defaultCountry,
      defaultCurrency: row.defaultCurrency,
      timeFormat: row.timeFormat,
      maintenanceMode: row.maintenanceMode,
    };
  }

  async getConfig(): Promise<PlatformConfigDTO> {
    return this.toDto(await this.row());
  }

  async updateConfig(platformUserId: string, dto: UpdatePlatformConfigDto): Promise<PlatformConfigDTO> {
    const current = await this.row();
    const updated = await this.prisma.platformConfig.update({
      where: { id: current.id },
      data: { ...dto, updatedById: platformUserId },
    });
    await this.audit.record({
      platformUserId,
      action: 'UPDATE',
      entityType: 'PlatformConfig',
      entityId: updated.id,
      metadata: { before: this.toDto(current), after: this.toDto(updated) },
    });
    return this.toDto(updated);
  }

  async setMaintenanceMode(platformUserId: string, maintenanceMode: boolean): Promise<PlatformConfigDTO> {
    const current = await this.row();
    const updated = await this.prisma.platformConfig.update({
      where: { id: current.id },
      data: { maintenanceMode, updatedById: platformUserId },
    });
    await this.audit.record({
      platformUserId,
      action: maintenanceMode ? 'MAINTENANCE_ON' : 'MAINTENANCE_OFF',
      entityType: 'PlatformConfig',
      entityId: updated.id,
    });
    return this.toDto(updated);
  }
}
