import { BadRequestException, Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';

@ApiTags('tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  create(@Headers('authorization') authorization: string | undefined, @Body() dto: CreateTenantDto) {
    const token = authorization?.replace(/^Bearer\s+/i, '')?.trim();
    if (!token) throw new BadRequestException('Missing sign-up token');
    return this.tenants.createFromPending(token, dto);
  }

  @Get('check-slug')
  checkSlug(@Query('slug') slug: string) {
    return this.tenants.checkSlug(slug ?? '');
  }

  @Get('resolve')
  resolve(@Query('identifier') identifier: string) {
    return this.tenants.resolvePublic(identifier ?? '');
  }
}
