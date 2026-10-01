import { Module } from '@nestjs/common';
import { AdmissionsController } from './admissions.controller';
import { AdmissionsService } from './admissions.service';
import { BedChargesService } from './bed-charges.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { EncountersModule } from '../encounters/encounters.module';

@Module({
  imports: [PrismaModule, BillingModule, EncountersModule],
  controllers: [AdmissionsController],
  providers: [AdmissionsService, BedChargesService],
})
export class AdmissionsModule {}
