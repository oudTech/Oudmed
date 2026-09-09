import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { uploadInterceptor } from '../storage/upload.util';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/settings.dto';

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.settings.get(u.tenantId);
  }

  @Patch()
  update(@CurrentUser() u: AuthUser, @Body() dto: UpdateSettingsDto) {
    return this.settings.update(actor(u), dto);
  }

  @Post('logo')
  @UseInterceptors(uploadInterceptor())
  setLogo(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File) {
    return this.settings.setLogo(actor(u), file);
  }

  @Delete('logo')
  removeLogo(@CurrentUser() u: AuthUser) {
    return this.settings.removeLogo(actor(u));
  }
}
