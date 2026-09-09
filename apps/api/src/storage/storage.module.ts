import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageService } from './storage.service';
import { FilesService } from './files.service';
import { ScanService } from './scan.service';
import { FilesController } from './files.controller';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [FilesController],
  providers: [StorageService, ScanService, FilesService],
  exports: [StorageService, ScanService, FilesService],
})
export class StorageModule {}
