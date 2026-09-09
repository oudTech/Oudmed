import { Module } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { ClinicalService } from './clinical.service';
import { PatientsController } from './patients.controller';
import { ClinicalController } from './clinical.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [PatientsController, ClinicalController],
  providers: [PatientsService, ClinicalService],
})
export class PatientsModule {}
