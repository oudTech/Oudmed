import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { DirectoryService } from './directory.service';

class ShiftDto {
  @IsInt() @Min(0) @Max(6) dayOfWeek: number;
  @IsInt() @Min(0) @Max(1439) startMinute: number;
  @IsInt() @Min(1) @Max(1440) endMinute: number;
}
class SetShiftsDto {
  @IsArray() @ArrayMaxSize(21) @ValidateNested({ each: true }) @Type(() => ShiftDto)
  shifts: ShiftDto[];
}

@ApiTags('directory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('directory')
export class DirectoryController {
  constructor(private directory: DirectoryService) {}

  @Get('staff')
  staff(@CurrentUser() user: AuthUser, @Query('role') role?: string) {
    return this.directory.staff(user.tenantId, role);
  }

  @Get('staff/:id/shifts')
  getShifts(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.directory.getShifts(user.tenantId, id);
  }

  @Put('staff/:id/shifts')
  setShifts(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SetShiftsDto) {
    return this.directory.setShifts(
      { tenantId: user.tenantId, userId: user.userId, role: user.role },
      id,
      dto.shifts,
    );
  }

  @Get('departments')
  departments(@CurrentUser() user: AuthUser) {
    return this.directory.departments(user.tenantId);
  }

  @Get('wards')
  wards(@CurrentUser() user: AuthUser) {
    return this.directory.wards(user.tenantId);
  }

  @Get('beds')
  beds(
    @CurrentUser() user: AuthUser,
    @Query('wardId') wardId?: string,
    @Query('status') status?: string,
  ) {
    return this.directory.beds(user.tenantId, wardId, status);
  }
}
