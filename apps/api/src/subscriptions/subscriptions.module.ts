import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../common/audit/audit.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PaystackClient } from './paystack.client';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, PaystackClient],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
