import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformAuthGuard } from '../platform-auth/platform-auth.guard';
import { CurrentPlatformUser, PlatformAuthUser } from '../platform-auth/current-platform-user.decorator';
import { PlatformUsersService } from './platform-users.service';
import { CreatePlatformUserDto } from './dto/create-platform-user.dto';

@ApiTags('platform-users')
@ApiBearerAuth()
@Controller('platform/users')
@UseGuards(PlatformAuthGuard)
export class PlatformUsersController {
  constructor(private users: PlatformUsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@CurrentPlatformUser() u: PlatformAuthUser, @Body() dto: CreatePlatformUserDto) {
    return this.users.create(u.platformUserId, dto);
  }

  @Patch(':id/deactivate')
  deactivate(@CurrentPlatformUser() u: PlatformAuthUser, @Param('id') id: string) {
    return this.users.setActive(u.platformUserId, id, false);
  }

  @Patch(':id/reactivate')
  reactivate(@CurrentPlatformUser() u: PlatformAuthUser, @Param('id') id: string) {
    return this.users.setActive(u.platformUserId, id, true);
  }
}
