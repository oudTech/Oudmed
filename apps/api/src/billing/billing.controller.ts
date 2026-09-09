import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/roles.decorator';
import { assertCan, can } from '../common/permissions';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { BillingService } from './billing.service';
import { CancelInvoiceDto, CreateInvoiceDto, ReversePaymentDto, UpdateInvoiceDto } from './dto/create-invoice.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';

class CreateServiceItemDto {
  @IsString() name: string;
  @IsOptional() @IsString() category?: string;
  @IsNumber() @Min(0) unitPrice: number;
}

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class BillingController {
  constructor(private billing: BillingService) {}

  // ── invoices list / detail / builder ──
  // Financial reads (invoices, receipts, price catalogue) are limited to the
  // roles that run the billing office. Authorization is enforced here at the
  // HTTP boundary, not in BillingService, because the service's read helpers are
  // also called internally by ClaimsService as part of already-authorized flows.
  @Get('billing/invoices')
  listInvoices(
    @CurrentUser() u: AuthUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    assertCan(u.role, 'billing:manage');
    return this.billing.listInvoices(u.tenantId, {
      search, status, category, from, to, page: page ? Number(page) : undefined,
    });
  }

  @Get('billing/catalogue')
  catalogue(@CurrentUser() u: AuthUser, @Query('type') type = 'Services', @Query('q') q?: string) {
    assertCan(u.role, 'billing:manage');
    return this.billing.catalogue(u.tenantId, type, q);
  }

  @Get('billing/invoices/:id')
  getInvoice(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    assertCan(u.role, 'billing:manage');
    return this.billing.getInvoice(u.tenantId, id);
  }

  @Post('billing/invoices')
  createInvoice(@CurrentUser() u: AuthUser, @Body() dto: CreateInvoiceDto) {
    return this.billing.createInvoice(actor(u), dto).then((inv) => ({ id: inv.id }));
  }

  @Post('billing/invoices/:id/payments')
  addPayment(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CreatePaymentDto) {
    return this.billing.addPayment(actor(u), id, dto);
  }

  @Patch('billing/invoices/:id')
  updateInvoice(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    return this.billing.updateInvoice(actor(u), id, dto);
  }

  @Delete('billing/invoices/:id/lines/:lineId')
  removeLine(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('lineId') lineId: string) {
    return this.billing.removeInvoiceLine(actor(u), id, lineId);
  }

  @Post('billing/invoices/:id/cancel')
  cancelInvoice(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CancelInvoiceDto) {
    return this.billing.cancelInvoice(actor(u), id, dto);
  }

  @Post('billing/payments/:id/reverse')
  reversePayment(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ReversePaymentDto) {
    return this.billing.reversePayment(actor(u), id, dto);
  }

  @Get('billing/payments/:id/receipt')
  receipt(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    assertCan(u.role, 'billing:manage');
    return this.billing.receipt(u.tenantId, id);
  }

  // ── legacy / shared ──
  @Post('invoices')
  @Roles(Role.ACCOUNTANT, Role.RECEPTIONIST, Role.HOSPITAL_ADMIN, Role.SUPER_ADMIN)
  createInvoiceLegacy(@CurrentUser() u: AuthUser, @Body() dto: CreateInvoiceDto) {
    return this.billing.createInvoice(actor(u), dto);
  }

  @Post('invoices/:id/payments')
  addPaymentLegacy(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CreatePaymentDto) {
    return this.billing.addPayment(actor(u), id, dto);
  }

  @Get('billing/service-items')
  serviceItems(@CurrentUser() u: AuthUser, @Query('category') category?: string, @Query('q') q?: string) {
    // Also readable by clinicians (order:create) - the encounter "create order"
    // screen autocompletes investigation / procedure service items from here.
    if (!can(u.role, 'billing:manage') && !can(u.role, 'order:create')) {
      assertCan(u.role, 'billing:manage');
    }
    return this.billing.listServiceItems(u.tenantId, category, q);
  }

  @Post('billing/service-items')
  @Roles(Role.HOSPITAL_ADMIN, Role.SUPER_ADMIN)
  createServiceItem(@CurrentUser() u: AuthUser, @Body() dto: CreateServiceItemDto) {
    return this.billing.createServiceItem(actor(u), dto);
  }
}
