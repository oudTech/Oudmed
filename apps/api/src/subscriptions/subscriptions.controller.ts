import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { assertCan } from '../common/permissions';
import { SubscriptionsService } from './subscriptions.service';
import { UpdatePlatformPricingDto } from './dto/update-pricing.dto';
import { CheckoutDto } from './dto/checkout.dto';

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private subscriptions: SubscriptionsService) {}

  /** Public - no session exists yet on the sign-up / pricing page. */
  @Get('pricing')
  getPricing() {
    return this.subscriptions.getPricing();
  }

  @Patch('pricing')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  updatePricing(@CurrentUser() u: AuthUser, @Body() dto: UpdatePlatformPricingDto) {
    return this.subscriptions.updatePricing(actor(u), dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getMine(@CurrentUser() u: AuthUser) {
    assertCan(u.role, 'admin:settings');
    return this.subscriptions.getMySubscription(u.tenantId);
  }

  @Get('invoices')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  listInvoices(@CurrentUser() u: AuthUser) {
    assertCan(u.role, 'admin:settings');
    return this.subscriptions.listMyInvoices(u.tenantId);
  }

  @Post('checkout/card')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  checkoutCard(@CurrentUser() u: AuthUser, @Body() dto: CheckoutDto) {
    return this.subscriptions.initiateCardCheckout(actor(u), dto);
  }

  @Get('checkout/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  verifyCheckout(@CurrentUser() u: AuthUser, @Query('reference') reference: string) {
    return this.subscriptions.verifyCardCheckout(actor(u), reference);
  }

  @Post('checkout/bank-transfer')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  checkoutBankTransfer(@CurrentUser() u: AuthUser, @Body() dto: CheckoutDto) {
    return this.subscriptions.initiateBankTransfer(actor(u), dto);
  }

  @Patch('invoices/:id/mark-paid')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  markInvoicePaid(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.subscriptions.markInvoicePaid(actor(u), id);
  }

  /**
   * Public (Paystack calls this directly - authenticity comes from the signed
   * body, not a session). Needs the raw request bytes to verify that
   * signature; main.ts captures them onto `req.rawBody` for exactly this path
   * since the global JSON body-parser would otherwise discard them.
   */
  @Post('webhooks/paystack')
  handlePaystackWebhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-paystack-signature') signature?: string) {
    return this.subscriptions.handlePaystackWebhook(req.rawBody ?? Buffer.from(''), signature);
  }
}
