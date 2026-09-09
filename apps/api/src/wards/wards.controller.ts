import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { WardsService } from './wards.service';
import { AddBedsDto, CreateWardDto, UpdateBedDto, UpdateWardDto } from './dto/wards.dto';

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

@ApiTags('wards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wards')
export class WardsController {
  constructor(private wards: WardsService) {}

  @Get()
  board(@CurrentUser() user: AuthUser) {
    return this.wards.board(user.tenantId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWardDto) {
    return this.wards.createWard(actor(user), dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateWardDto) {
    return this.wards.updateWard(actor(user), id, dto);
  }

  @Post(':id/beds')
  addBeds(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddBedsDto) {
    return this.wards.addBeds(actor(user), id, dto);
  }

  @Patch(':id/beds/:bedId')
  updateBed(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('bedId') bedId: string,
    @Body() dto: UpdateBedDto,
  ) {
    return this.wards.updateBed(actor(user), id, bedId, dto);
  }
}
