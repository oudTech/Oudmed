import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { StaffService } from './staff.service';
import { CreateStaffDto, ListStaffQueryDto, SetPasswordDto, UpdateStaffDto } from './dto/staff.dto';

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

@ApiTags('staff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('staff')
export class StaffController {
  constructor(private staff: StaffService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListStaffQueryDto) {
    return this.staff.list(actor(u), q);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateStaffDto) {
    return this.staff.create(actor(u), dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.staff.getOne(actor(u), id);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.staff.update(actor(u), id, dto);
  }

  @Post(':id/activate')
  activate(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.staff.setActive(actor(u), id, true);
  }

  @Post(':id/deactivate')
  deactivate(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.staff.setActive(actor(u), id, false);
  }

  @Post(':id/set-password')
  setPassword(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SetPasswordDto) {
    return this.staff.setPassword(actor(u), id, dto);
  }
}
