import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { MeService } from './me.service';
import { UpdatePreferencesDto } from './dto/preferences.dto';

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get('preferences')
  get(@CurrentUser() u: AuthUser) {
    return this.me.getPreferences(u.userId);
  }

  @Patch('preferences')
  update(@CurrentUser() u: AuthUser, @Body() dto: UpdatePreferencesDto) {
    return this.me.updatePreferences(u.userId, dto);
  }
}
