import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { assertCan, can } from '../common/permissions';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PharmacyService } from './pharmacy.service';
import { PharmacyInventoryService } from './inventory.service';
import { DispenseDto } from './dto/pharmacy.dto';
import {
  AdjustStockDto,
  CreateDrugDto,
  ImportDrugsDto,
  ListDrugsQueryDto,
  ReceiveBatchDto,
  UpdateDrugDto,
} from './dto/inventory.dto';

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

@ApiTags('pharmacy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('pharmacy')
export class PharmacyController {
  constructor(
    private pharmacy: PharmacyService,
    private inventory: PharmacyInventoryService,
  ) {}

  // ── dispensing queue ──
  @Get('queue')
  queue(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    assertCan(u.role, 'prescription:dispense');
    return this.pharmacy.queue(u.tenantId, status);
  }

  @Post('prescriptions/:id/dispense')
  dispense(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DispenseDto) {
    return this.pharmacy.dispense(actor(u), id, dto);
  }

  @Patch('prescriptions/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.pharmacy.cancel(actor(u), id);
  }

  // ── drug inventory (static routes before :id) ──
  @Get('drugs/stats')
  drugStats(@CurrentUser() u: AuthUser) {
    assertCan(u.role, 'pharmacy:manage');
    return this.inventory.stats(u.tenantId);
  }

  @Get('drugs/search')
  drugSearch(@CurrentUser() u: AuthUser, @Query('q') q = '') {
    // Prescribers also read this - the prescription screen autocompletes drug
    // names (and needs stock / price) from the formulary.
    if (!can(u.role, 'pharmacy:manage') && !can(u.role, 'prescription:write')) {
      assertCan(u.role, 'pharmacy:manage');
    }
    return this.inventory.search(u.tenantId, q);
  }

  @Get('drugs')
  drugList(@CurrentUser() u: AuthUser, @Query() q: ListDrugsQueryDto) {
    assertCan(u.role, 'pharmacy:manage');
    return this.inventory.list(u.tenantId, q);
  }

  @Post('drugs')
  createDrug(@CurrentUser() u: AuthUser, @Body() dto: CreateDrugDto) {
    return this.inventory.create(actor(u), dto);
  }

  @Post('drugs/import')
  importDrugs(@CurrentUser() u: AuthUser, @Body() dto: ImportDrugsDto) {
    return this.inventory.importDrugs(actor(u), dto.rows);
  }

  @Post('drugs/reconcile')
  reconcile(@CurrentUser() u: AuthUser) {
    return this.inventory.reconcileStock(actor(u));
  }

  @Get('drugs/:id')
  getDrug(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    assertCan(u.role, 'pharmacy:manage');
    return this.inventory.getOne(u.tenantId, id);
  }

  @Patch('drugs/:id')
  updateDrug(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateDrugDto) {
    return this.inventory.update(actor(u), id, dto);
  }

  @Delete('drugs/:id')
  removeDrug(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.inventory.remove(actor(u), id);
  }

  @Post('drugs/:id/batches')
  receiveBatch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ReceiveBatchDto) {
    return this.inventory.receiveBatch(actor(u), id, dto);
  }

  @Post('drugs/:id/adjust')
  adjustStock(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AdjustStockDto) {
    return this.inventory.adjust(actor(u), id, dto);
  }
}
