import { Controller, Get, Header, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformAuthGuard } from '../platform-auth/platform-auth.guard';
import { CurrentPlatformUser, PlatformAuthUser } from '../platform-auth/current-platform-user.decorator';
import { SubscriptionsService } from './subscriptions.service';

class ListSubscriptionsQueryDto {
  @IsOptional() @IsIn(['all', 'trialing', 'active', 'past_due', 'suspended', 'cancelled']) status?: string;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;
}

/**
 * The platform-operator side of subscriptions - actions a hospital cannot
 * take on itself, reachable only by a genuine platform identity (see
 * platform-auth), never by a hospital's own SUPER_ADMIN. Kept separate from
 * SubscriptionsController (a hospital's own view of its own subscription) so
 * the two audiences are never confused at the routing level.
 */
@ApiTags('platform-subscriptions')
@Controller('platform/subscriptions')
@UseGuards(PlatformAuthGuard)
@ApiBearerAuth()
export class PlatformSubscriptionsController {
  constructor(private subscriptions: SubscriptionsService) {}

  @Get()
  list(@Query() q: ListSubscriptionsQueryDto) {
    return this.subscriptions.listAllSubscriptions(q);
  }

  @Get('stats')
  stats() {
    return this.subscriptions.subscriptionInvoiceStats();
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="subscriptions.csv"')
  exportCsv(@Query() q: ListSubscriptionsQueryDto) {
    return this.subscriptions.subscriptionsExportCsv(q.status);
  }

  @Patch(':tenantId/invoices/:invoiceId/mark-paid')
  markInvoicePaid(
    @CurrentPlatformUser() u: PlatformAuthUser,
    @Param('tenantId') tenantId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.subscriptions.markInvoicePaidAsPlatform(tenantId, invoiceId, u.platformUserId);
  }
}
