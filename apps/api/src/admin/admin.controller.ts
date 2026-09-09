import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { AdminService } from './admin.service';
import {
  DepartmentDto,
  InsuranceProviderDto,
  ListQueryDto,
  ServiceItemDto,
  UpdateDepartmentDto,
  UpdateInsuranceProviderDto,
  UpdateServiceItemDto,
} from './dto/admin.dto';

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private admin: AdminService) {}

  // ── departments ──

  @Get('departments')
  listDepartments(@CurrentUser() u: AuthUser, @Query() q: ListQueryDto) {
    return this.admin.listDepartments(u.tenantId, q);
  }

  @Post('departments')
  createDepartment(@CurrentUser() u: AuthUser, @Body() dto: DepartmentDto) {
    return this.admin.createDepartment(actor(u), dto);
  }

  @Patch('departments/:id')
  updateDepartment(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.admin.updateDepartment(actor(u), id, dto);
  }

  @Post('departments/:id/toggle')
  toggleDepartment(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.admin.toggleDepartment(actor(u), id);
  }

  @Delete('departments/:id')
  deleteDepartment(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.admin.deleteDepartment(actor(u), id);
  }

  // ── services ──

  @Get('services')
  listServices(@CurrentUser() u: AuthUser, @Query() q: ListQueryDto) {
    return this.admin.listServices(u.tenantId, q);
  }

  @Post('services')
  createService(@CurrentUser() u: AuthUser, @Body() dto: ServiceItemDto) {
    return this.admin.createService(actor(u), dto);
  }

  @Patch('services/:id')
  updateService(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateServiceItemDto) {
    return this.admin.updateService(actor(u), id, dto);
  }

  @Post('services/:id/toggle')
  toggleService(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.admin.toggleService(actor(u), id);
  }

  @Delete('services/:id')
  deleteService(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.admin.deleteService(actor(u), id);
  }

  // ── insurance providers ──

  @Get('insurance-providers')
  listProviders(@CurrentUser() u: AuthUser, @Query() q: ListQueryDto) {
    return this.admin.listProviders(u.tenantId, q);
  }

  @Get('insurance-providers/options')
  providerOptions(@CurrentUser() u: AuthUser, @Query('kind') kind?: string) {
    return this.admin.providerOptions(u.tenantId, kind);
  }

  @Post('insurance-providers')
  createProvider(@CurrentUser() u: AuthUser, @Body() dto: InsuranceProviderDto) {
    return this.admin.createProvider(actor(u), dto);
  }

  @Patch('insurance-providers/:id')
  updateProvider(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateInsuranceProviderDto) {
    return this.admin.updateProvider(actor(u), id, dto);
  }

  @Post('insurance-providers/:id/toggle')
  toggleProvider(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.admin.toggleProvider(actor(u), id);
  }

  @Delete('insurance-providers/:id')
  deleteProvider(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.admin.deleteProvider(actor(u), id);
  }
}
