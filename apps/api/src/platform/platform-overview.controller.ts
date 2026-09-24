import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformAuthGuard } from '../platform-auth/platform-auth.guard';
import { PlatformOverviewService } from './platform-overview.service';

class ActivityQueryDto {
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;
}

@ApiTags('platform-overview')
@ApiBearerAuth()
@Controller('platform')
@UseGuards(PlatformAuthGuard)
export class PlatformOverviewController {
  constructor(private overview: PlatformOverviewService) {}

  @Get('overview')
  getOverview() {
    return this.overview.overview();
  }

  @Get('activity')
  getActivity(@Query() q: ActivityQueryDto) {
    return this.overview.activity(q.page);
  }
}
