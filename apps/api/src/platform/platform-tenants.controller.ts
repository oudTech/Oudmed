import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformAuthGuard } from '../platform-auth/platform-auth.guard';
import { CurrentPlatformUser, PlatformAuthUser } from '../platform-auth/current-platform-user.decorator';
import { PlatformTenantsService } from './platform-tenants.service';
import { CreateTenantDirectDto } from './dto/create-tenant-direct.dto';
import { ListTenantsQueryDto } from './dto/list-tenants-query.dto';

@ApiTags('platform-tenants')
@ApiBearerAuth()
@Controller('platform/tenants')
@UseGuards(PlatformAuthGuard)
export class PlatformTenantsController {
  constructor(private tenants: PlatformTenantsService) {}

  @Get()
  list(@Query() q: ListTenantsQueryDto) {
    return this.tenants.listTenants(q);
  }

  // Must come before ':id' - otherwise that route would shadow this one and
  // treat "export.csv" as a tenant id.
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="hospitals.csv"')
  exportCsv(@Query() q: ListTenantsQueryDto) {
    return this.tenants.exportCsv(q);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.tenants.getTenant(id);
  }

  @Post()
  create(@CurrentPlatformUser() u: PlatformAuthUser, @Body() dto: CreateTenantDirectDto) {
    return this.tenants.createTenant(u.platformUserId, dto);
  }

  @Post(':id/suspend')
  suspend(@CurrentPlatformUser() u: PlatformAuthUser, @Param('id') id: string) {
    return this.tenants.suspend(u.platformUserId, id);
  }

  @Post(':id/reactivate')
  reactivate(@CurrentPlatformUser() u: PlatformAuthUser, @Param('id') id: string) {
    return this.tenants.reactivate(u.platformUserId, id);
  }
}
