import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
// Aliased: this app already has an (unrelated) outpatient-appointment module
// also named ScheduleModule, imported a few lines below.
import { ScheduleModule as CronModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';
import { AuditModule } from './common/audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { DirectoryModule } from './directory/directory.module';
import { WardsModule } from './wards/wards.module';
import { PatientsModule } from './patients/patients.module';
import { ScheduleModule } from './schedule/schedule.module';
import { AdmissionsModule } from './admissions/admissions.module';
import { BillingModule } from './billing/billing.module';
import { EncountersModule } from './encounters/encounters.module';
import { PharmacyModule } from './pharmacy/pharmacy.module';
import { StaffModule } from './staff/staff.module';
import { AdminModule } from './admin/admin.module';
import { ReportsModule } from './reports/reports.module';
import { ClaimsModule } from './claims/claims.module';
import { StorageModule } from './storage/storage.module';
import { SettingsModule } from './settings/settings.module';
import { HomeModule } from './home/home.module';
import { MeModule } from './me/me.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PlatformAuthModule } from './platform-auth/platform-auth.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    CronModule.forRoot(),
    PrismaModule,
    EmailModule,
    AuditModule,
    StorageModule,
    AuthModule,
    TenantsModule,
    DirectoryModule,
    WardsModule,
    PatientsModule,
    ScheduleModule,
    AdmissionsModule,
    BillingModule,
    EncountersModule,
    PharmacyModule,
    StaffModule,
    AdminModule,
    ReportsModule,
    ClaimsModule,
    SettingsModule,
    HomeModule,
    MeModule,
    SubscriptionsModule,
    PlatformAuthModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
