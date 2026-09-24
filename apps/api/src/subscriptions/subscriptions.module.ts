import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../common/audit/audit.module';
import { PlatformAuthModule } from '../platform-auth/platform-auth.module';
import { SubscriptionsController } from './subscriptions.controller';
import { PlatformSubscriptionsController } from './platform-subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PaystackClient } from './paystack.client';
import { EntitlementsService } from './entitlements.service';

@Module({
  imports: [PrismaModule, AuditModule, PlatformAuthModule],
  controllers: [SubscriptionsController, PlatformSubscriptionsController],
  providers: [SubscriptionsService, PaystackClient, EntitlementsService],
  exports: [SubscriptionsService, EntitlementsService],
})
export class SubscriptionsModule {}
