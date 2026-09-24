import { Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformAuthGuard } from '../platform-auth/platform-auth.guard';
import { CurrentPlatformUser, PlatformAuthUser } from '../platform-auth/current-platform-user.decorator';
import { SubscriptionsService } from './subscriptions.service';

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

  @Patch(':tenantId/invoices/:invoiceId/mark-paid')
  markInvoicePaid(
    @CurrentPlatformUser() u: PlatformAuthUser,
    @Param('tenantId') tenantId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.subscriptions.markInvoicePaidAsPlatform(tenantId, invoiceId, u.platformUserId);
  }
}
