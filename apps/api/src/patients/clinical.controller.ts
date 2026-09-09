import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ClinicalService } from './clinical.service';
import {
  CreateComplaintDto,
  CreateDiagnosisDto,
  CreatePrescriptionDto,
  CreateVitalsDto,
  UpdateComplaintDto,
  UpdatePrescriptionDto,
} from './dto/clinical.dto';

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

class PayInvoiceDto {
  @IsNumber() @Min(1) amount: number;
  @IsOptional() @IsIn(['CASH', 'CARD', 'TRANSFER', 'HMO']) method?: string;
  @IsOptional() @IsIn(['CASH', 'HMO', 'NHIS', 'RETAINER']) payerType?: string;
  @IsOptional() @IsString() payerName?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() @MaxLength(64) idempotencyKey?: string;
}

@ApiTags('patients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('patients/:patientId')
export class ClinicalController {
  constructor(private clinical: ClinicalService) {}

  @Get('appointments')
  appointments(@CurrentUser() u: AuthUser, @Param('patientId') pid: string) {
    return this.clinical.listAppointments(actor(u), pid);
  }

  @Get('invoices')
  invoices(@CurrentUser() u: AuthUser, @Param('patientId') pid: string) {
    return this.clinical.listInvoices(actor(u), pid);
  }

  @Get('orders')
  orders(@CurrentUser() u: AuthUser, @Param('patientId') pid: string) {
    return this.clinical.listOrders(actor(u), pid);
  }

  @Get('notes')
  notes(@CurrentUser() u: AuthUser, @Param('patientId') pid: string) {
    return this.clinical.listNotes(actor(u), pid);
  }

  @Post('invoices/:id/payments')
  payInvoice(
    @CurrentUser() u: AuthUser,
    @Param('patientId') pid: string,
    @Param('id') id: string,
    @Body() dto: PayInvoiceDto,
  ) {
    return this.clinical.payInvoice(actor(u), pid, id, dto);
  }

  @Get('complaints')
  complaints(@CurrentUser() u: AuthUser, @Param('patientId') pid: string) {
    return this.clinical.listComplaints(actor(u), pid);
  }

  @Post('complaints')
  addComplaint(
    @CurrentUser() u: AuthUser,
    @Param('patientId') pid: string,
    @Body() dto: CreateComplaintDto,
  ) {
    return this.clinical.addComplaint(actor(u), pid, dto);
  }

  @Patch('complaints/:id')
  updateComplaint(
    @CurrentUser() u: AuthUser,
    @Param('patientId') pid: string,
    @Param('id') id: string,
    @Body() dto: UpdateComplaintDto,
  ) {
    return this.clinical.updateComplaint(actor(u), pid, id, dto);
  }

  @Get('diagnoses')
  diagnoses(@CurrentUser() u: AuthUser, @Param('patientId') pid: string) {
    return this.clinical.listDiagnoses(actor(u), pid);
  }

  @Post('diagnoses')
  addDiagnosis(
    @CurrentUser() u: AuthUser,
    @Param('patientId') pid: string,
    @Body() dto: CreateDiagnosisDto,
  ) {
    return this.clinical.addDiagnosis(actor(u), pid, dto);
  }

  @Get('vitals')
  vitals(@CurrentUser() u: AuthUser, @Param('patientId') pid: string) {
    return this.clinical.listVitals(actor(u), pid);
  }

  @Post('vitals')
  addVitals(
    @CurrentUser() u: AuthUser,
    @Param('patientId') pid: string,
    @Body() dto: CreateVitalsDto,
  ) {
    return this.clinical.addVitals(actor(u), pid, dto);
  }

  @Get('prescriptions')
  prescriptions(@CurrentUser() u: AuthUser, @Param('patientId') pid: string) {
    return this.clinical.listPrescriptions(actor(u), pid);
  }

  @Post('prescriptions')
  addPrescription(
    @CurrentUser() u: AuthUser,
    @Param('patientId') pid: string,
    @Body() dto: CreatePrescriptionDto,
  ) {
    return this.clinical.addPrescription(actor(u), pid, dto);
  }

  @Patch('prescriptions/:id')
  updatePrescription(
    @CurrentUser() u: AuthUser,
    @Param('patientId') pid: string,
    @Param('id') id: string,
    @Body() dto: UpdatePrescriptionDto,
  ) {
    return this.clinical.updatePrescription(actor(u), pid, id, dto);
  }
}
