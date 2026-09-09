import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { assertCan } from '../common/permissions';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { EncountersService } from './encounters.service';
import { CreateOrderDto, UpdateOrderDto, UpsertNoteDto } from './dto/encounter.dto';

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

@ApiTags('encounters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class EncountersController {
  constructor(private encounters: EncountersService) {}

  @Get('lab/worklist')
  labWorklist(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    assertCan(u.role, 'order:result');
    return this.encounters.labWorklist(u.tenantId, status);
  }

  @Patch('encounters/orders/:id')
  updateOrder(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.encounters.updateOrder(actor(u), id, dto);
  }

  @Get('encounters/:visitId')
  get(@CurrentUser() u: AuthUser, @Param('visitId') visitId: string) {
    return this.encounters.getEncounter(actor(u), visitId);
  }

  @Put('encounters/:visitId/note')
  saveNote(
    @CurrentUser() u: AuthUser,
    @Param('visitId') visitId: string,
    @Body() dto: UpsertNoteDto,
  ) {
    return this.encounters.upsertNote(actor(u), visitId, dto);
  }

  @Post('encounters/:visitId/orders')
  createOrder(
    @CurrentUser() u: AuthUser,
    @Param('visitId') visitId: string,
    @Body() dto: CreateOrderDto,
  ) {
    return this.encounters.createOrder(actor(u), visitId, dto);
  }
}
