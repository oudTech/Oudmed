import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';
import { PharmacyInventoryService } from './inventory.service';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [PharmacyController],
  providers: [PharmacyService, PharmacyInventoryService],
})
export class PharmacyModule {}
