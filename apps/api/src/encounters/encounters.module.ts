import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { EncountersController } from './encounters.controller';
import { EncountersService } from './encounters.service';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [EncountersController],
  providers: [EncountersService],
})
export class EncountersModule {}
