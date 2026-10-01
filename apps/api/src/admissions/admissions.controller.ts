import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { assertCan } from '../common/permissions';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { AdmissionsService } from './admissions.service';
import { EncountersService } from '../encounters/encounters.service';
import { CreateOrderDto, UpsertNoteDto, AddNoteAddendumDto } from '../encounters/dto/encounter.dto';
import {
  ApplyDepositDto,
  CreateAdmissionDto,
  CreateDepositDto,
  DischargeAdmissionDto,
  ListAdmissionsQueryDto,
  PayRefundDto,
  RefundDepositDto,
  ReopenAdmissionDto,
  TransferAdmissionDto,
  UpdateAdmissionDto,
} from './dto/admissions.dto';

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

@ApiTags('admissions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admissions')
export class AdmissionsController {
  constructor(
    private admissions: AdmissionsService,
    private encounters: EncountersService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListAdmissionsQueryDto) {
    assertCan(user.role, 'patient:read');
    return this.admissions.list(user.tenantId, query);
  }

  // Must be registered before ':id' - otherwise "refunds" would be matched
  // as an admission id.
  @Get('refunds/due')
  listPendingRefunds(@CurrentUser() user: AuthUser) {
    assertCan(user.role, 'admission:deposit-refund');
    return this.admissions.listPendingRefunds(user.tenantId);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertCan(user.role, 'patient:read');
    return this.admissions.getOne(user.tenantId, id);
  }

  @Post()
  admit(@CurrentUser() user: AuthUser, @Body() dto: CreateAdmissionDto) {
    return this.admissions.admit(actor(user), dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateAdmissionDto) {
    return this.admissions.update(actor(user), id, dto);
  }

  @Post(':id/transfer')
  transfer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: TransferAdmissionDto,
  ) {
    return this.admissions.transfer(actor(user), id, dto);
  }

  @Post(':id/discharge')
  discharge(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DischargeAdmissionDto,
  ) {
    return this.admissions.discharge(actor(user), id, dto);
  }

  @Get(':id/workspace')
  workspace(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertCan(user.role, 'patient:read');
    return this.admissions.workspace(user.tenantId, id);
  }

  @Get(':id/bill')
  bill(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertCan(user.role, 'billing:manage');
    return this.admissions.bill(user.tenantId, id);
  }

  @Post(':id/deposits')
  addDeposit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateDepositDto) {
    return this.admissions.addDeposit(actor(user), id, dto);
  }

  @Post(':id/deposits/:depositId/refund')
  refundDeposit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('depositId') depositId: string,
    @Body() dto: RefundDepositDto,
  ) {
    return this.admissions.refundDeposit(actor(user), id, depositId, dto);
  }

  @Get(':id/deposits/:depositId/receipt')
  depositReceipt(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('depositId') depositId: string,
  ) {
    assertCan(user.role, 'admission:deposit');
    return this.admissions.depositReceipt(user.tenantId, id, depositId);
  }

  @Post(':id/orders')
  createOrder(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateOrderDto) {
    return this.encounters.createOrder(actor(user), { admissionId: id }, dto);
  }

  @Post(':id/apply-deposit')
  applyDeposit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ApplyDepositDto) {
    return this.admissions.applyDeposit(actor(user), id, dto);
  }

  @Post(':id/reopen')
  reopen(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReopenAdmissionDto) {
    return this.admissions.reopen(actor(user), id, dto);
  }

  @Post(':id/notes')
  addNote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpsertNoteDto) {
    return this.admissions.addNote(actor(user), id, dto);
  }

  @Post(':id/notes/:noteId/addenda')
  addNoteAddendum(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body() dto: AddNoteAddendumDto,
  ) {
    return this.admissions.addNoteAddendum(actor(user), id, noteId, dto);
  }

  @Get(':id/discharge-summary')
  dischargeSummary(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertCan(user.role, 'patient:read');
    return this.admissions.dischargeSummary(user.tenantId, id);
  }

  @Post(':id/refunds/:refundId/pay')
  payRefund(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('refundId') refundId: string,
    @Body() dto: PayRefundDto,
  ) {
    return this.admissions.payRefund(actor(user), id, refundId, dto);
  }
}
