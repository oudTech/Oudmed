import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { HomeService } from './home.service';

@ApiTags('home')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('home')
export class HomeController {
  constructor(private home: HomeService) {}

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.home.forActor({ tenantId: u.tenantId, userId: u.userId, role: u.role });
  }
}
