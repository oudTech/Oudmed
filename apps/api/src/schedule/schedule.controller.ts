import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { assertCan } from '../common/permissions';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ScheduleService } from './schedule.service';
import {
  CreateVisitDto,
  ListVisitsQueryDto,
  RescheduleVisitDto,
  SetVisitStatusDto,
  UpdateVisitDto,
} from './dto/schedule.dto';

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

@ApiTags('schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schedule')
export class ScheduleController {
  constructor(private schedule: ScheduleService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListVisitsQueryDto) {
    assertCan(user.role, 'patient:read');
    return this.schedule.list(user.tenantId, query);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertCan(user.role, 'patient:read');
    return this.schedule.getOne(user.tenantId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVisitDto) {
    return this.schedule.create(actor(user), dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateVisitDto) {
    return this.schedule.update(actor(user), id, dto);
  }

  @Post(':id/reschedule')
  reschedule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RescheduleVisitDto,
  ) {
    return this.schedule.reschedule(actor(user), id, dto);
  }

  @Post(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetVisitStatusDto,
  ) {
    return this.schedule.setStatus(actor(user), id, dto);
  }
}
