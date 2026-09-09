import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { uploadInterceptor } from '../storage/upload.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { PatientsService } from './patients.service';
import {
  CheckDuplicatesDto,
  CreatePatientDto,
  ListPatientsQueryDto,
  UpdatePatientDto,
} from './dto/patient.dto';

class AddDocumentDto {
  @IsString() @MaxLength(40) category: string;
  @IsString() @MaxLength(160) title: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

@ApiTags('patients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('patients')
export class PatientsController {
  constructor(private patients: PatientsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListPatientsQueryDto) {
    return this.patients.list(actor(user), query);
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthUser) {
    return this.patients.stats(actor(user));
  }

  @Post('check-duplicates')
  @Throttle({ default: { limit: 40, ttl: 60 * 1000 } })
  checkDuplicates(@CurrentUser() user: AuthUser, @Body() dto: CheckDuplicatesDto) {
    return this.patients.checkDuplicates(actor(user), dto);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePatientDto) {
    return this.patients.create(actor(user), dto);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.patients.getOne(actor(user), id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdatePatientDto) {
    return this.patients.update(actor(user), id, dto);
  }

  @Get(':id/documents')
  documents(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.patients.listDocuments(actor(user), id);
  }

  @Get(':id/documents/:docId/url')
  documentUrl(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.patients.documentDownloadUrl(actor(user), id, docId);
  }

  @Post(':id/documents')
  @UseInterceptors(uploadInterceptor())
  addDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.patients.addDocument(actor(user), id, dto, file);
  }

  @Delete(':id/documents/:docId')
  deleteDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.patients.deleteDocument(actor(user), id, docId);
  }

  @Post(':id/photo')
  @UseInterceptors(uploadInterceptor())
  setPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.patients.setPhoto(actor(user), id, file);
  }
}
