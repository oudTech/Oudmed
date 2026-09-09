import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ReportGranularity } from '@oudhealth/contracts';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ReportsService } from './reports.service';

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('overview')
  overview(
    @CurrentUser() u: AuthUser,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: ReportGranularity,
  ) {
    return this.reports.overview(actor(u), { preset, from, to, granularity });
  }

  @Get('payments')
  payments(
    @CurrentUser() u: AuthUser,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
    @Query('doctorId') doctorId?: string,
    @Query('page') page?: string,
  ) {
    return this.reports.payments(actor(u), {
      preset,
      from,
      to,
      departmentId,
      doctorId,
      page: page ? Number(page) : undefined,
    });
  }

  @Get('payments.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="payment-ledger.csv"')
  paymentsCsv(
    @CurrentUser() u: AuthUser,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
    @Query('doctorId') doctorId?: string,
  ) {
    return this.reports.paymentsCsv(actor(u), { preset, from, to, departmentId, doctorId });
  }
}
