import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PlatformAuditService } from './platform-audit.service';

@Global()
@Module({
  providers: [AuditService, PlatformAuditService],
  exports: [AuditService, PlatformAuditService],
})
export class AuditModule {}
