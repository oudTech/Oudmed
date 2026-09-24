import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformAuthModule } from '../platform-auth/platform-auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';
import { PlatformOverviewController } from './platform-overview.controller';
import { PlatformOverviewService } from './platform-overview.service';
import { PlatformConfigController } from './platform-config.controller';
import { PlatformConfigService } from './platform-config.service';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformUsersService } from './platform-users.service';

@Module({
  imports: [PrismaModule, PlatformAuthModule, SubscriptionsModule],
  controllers: [
    PlatformTenantsController,
    PlatformOverviewController,
    PlatformConfigController,
    PlatformUsersController,
  ],
  providers: [PlatformTenantsService, PlatformOverviewService, PlatformConfigService, PlatformUsersService],
  exports: [PlatformTenantsService],
})
export class PlatformModule {}
