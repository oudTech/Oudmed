import { Body, Controller, Get, Header, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ClaimsService } from './claims.service';
import {
  BatchClaimsDto,
  ClaimListQueryDto,
  CreateBatchDto,
  CreateClaimDto,
  CreateRemittanceDto,
  EligibleVisitsQueryDto,
  GenerateClaimsDto,
  ListQueryDto,
  OpenClaimsQueryDto,
  ReasonDto,
  SubmitBatchDto,
  SubmitClaimDto,
  UpdateClaimDto,
} from './dto/claims.dto';

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

@ApiTags('claims')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('claims')
export class ClaimsController {
  constructor(private claims: ClaimsService) {}

  // ── batches (declared before :id routes) ──

  @Get('batches')
  listBatches(@CurrentUser() u: AuthUser, @Query() q: ListQueryDto) {
    return this.claims.listBatches(actor(u), q);
  }

  @Post('batches')
  createBatch(@CurrentUser() u: AuthUser, @Body() dto: CreateBatchDto) {
    return this.claims.createBatch(actor(u), dto);
  }

  @Get('batches/:id')
  getBatch(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.claims.getBatch(actor(u), id);
  }

  @Get('batches/:id/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="claim-schedule.csv"')
  batchCsv(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.claims.batchCsv(actor(u), id);
  }

  @Post('batches/:id/add')
  addToBatch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: BatchClaimsDto) {
    return this.claims.batchClaims(actor(u), id, dto, true);
  }

  @Post('batches/:id/remove')
  removeFromBatch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: BatchClaimsDto) {
    return this.claims.batchClaims(actor(u), id, dto, false);
  }

  @Post('batches/:id/submit')
  submitBatch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SubmitBatchDto) {
    return this.claims.submitBatch(actor(u), id, dto);
  }

  @Post('batches/:id/close')
  closeBatch(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.claims.closeBatch(actor(u), id);
  }

  // ── remittances ──

  @Get('remittances')
  listRemittances(@CurrentUser() u: AuthUser, @Query() q: ListQueryDto) {
    return this.claims.listRemittances(actor(u), q);
  }

  @Post('remittances')
  createRemittance(@CurrentUser() u: AuthUser, @Body() dto: CreateRemittanceDto) {
    return this.claims.createRemittance(actor(u), dto);
  }

  @Get('remittances/open-claims')
  openClaims(@CurrentUser() u: AuthUser, @Query() q: OpenClaimsQueryDto) {
    return this.claims.openClaims(actor(u), q);
  }

  @Get('remittances/:id')
  getRemittance(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.claims.getRemittance(actor(u), id);
  }

  @Post('remittances/:id/reverse')
  reverseRemittance(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.claims.reverseRemittance(actor(u), id, dto);
  }

  // ── receivables ──

  @Get('receivables')
  receivables(@CurrentUser() u: AuthUser) {
    return this.claims.receivables(actor(u));
  }

  // ── claims ──

  @Get('eligible-visits')
  eligibleVisits(@CurrentUser() u: AuthUser, @Query() q: EligibleVisitsQueryDto) {
    return this.claims.eligibleVisits(actor(u), q);
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ClaimListQueryDto) {
    return this.claims.listClaims(actor(u), q);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateClaimDto) {
    return this.claims.createManual(actor(u), dto);
  }

  @Post('generate')
  generate(@CurrentUser() u: AuthUser, @Body() dto: GenerateClaimsDto) {
    return this.claims.generate(actor(u), dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.claims.getClaim(actor(u), id);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateClaimDto) {
    return this.claims.updateClaim(actor(u), id, dto);
  }

  @Post(':id/submit')
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SubmitClaimDto) {
    return this.claims.submitClaim(actor(u), id, dto);
  }

  @Post(':id/write-off')
  writeOff(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.claims.writeOffClaim(actor(u), id, dto);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.claims.cancelClaim(actor(u), id, dto);
  }
}
