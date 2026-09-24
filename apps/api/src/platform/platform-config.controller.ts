import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformAuthGuard } from '../platform-auth/platform-auth.guard';
import { CurrentPlatformUser, PlatformAuthUser } from '../platform-auth/current-platform-user.decorator';
import { PlatformConfigService } from './platform-config.service';
import { SetMaintenanceModeDto, UpdatePlatformConfigDto } from './dto/update-platform-config.dto';

@ApiTags('platform-config')
@ApiBearerAuth()
@Controller('platform/config')
@UseGuards(PlatformAuthGuard)
export class PlatformConfigController {
  constructor(private config: PlatformConfigService) {}

  @Get()
  get() {
    return this.config.getConfig();
  }

  @Patch()
  update(@CurrentPlatformUser() u: PlatformAuthUser, @Body() dto: UpdatePlatformConfigDto) {
    return this.config.updateConfig(u.platformUserId, dto);
  }

  @Patch('maintenance')
  setMaintenance(@CurrentPlatformUser() u: PlatformAuthUser, @Body() dto: SetMaintenanceModeDto) {
    return this.config.setMaintenanceMode(u.platformUserId, dto.maintenanceMode);
  }
}
