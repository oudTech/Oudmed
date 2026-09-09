import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Redirect,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { FileCategory, FilesService } from './files.service';
import { uploadInterceptor } from './upload.util';

const actor = (u: AuthUser) => ({ tenantId: u.tenantId, userId: u.userId, role: u.role });

const CATEGORIES: FileCategory[] = ['PHOTO', 'DOCUMENT', 'LOGO', 'RESULT', 'OTHER'];
const normCategory = (v?: string): FileCategory =>
  CATEGORIES.includes((v ?? '').toUpperCase() as FileCategory) ? ((v as string).toUpperCase() as FileCategory) : 'OTHER';

@ApiTags('files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private files: FilesService) {}

  @Post()
  @UseInterceptors(uploadInterceptor())
  upload(
    @CurrentUser() u: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category?: string,
  ) {
    return this.files.upload(actor(u), file, normCategory(category));
  }

  /** Reconcile this tenant's objects against its StoredFile rows (admin:settings). */
  @Post('sweep')
  sweep(@CurrentUser() u: AuthUser) {
    return this.files.sweepOrphans(actor(u));
  }

  // The generic routes below expose a raw file handle. Legitimate document /
  // photo / logo access goes through the owning resource (patients, settings),
  // which mints presigned URLs itself - so these are gated to the uploader or a
  // hospital admin, not merely "same tenant".

  @Get(':id/meta')
  async meta(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.files.assertActorCanUseHandle(actor(u), id);
    return this.files.get(actor(u), id);
  }

  @Get(':id')
  @Redirect()
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.files.assertActorCanUseHandle(actor(u), id);
    return { url: await this.files.presignedUrl(actor(u), id), statusCode: 302 };
  }

  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.files.assertActorCanUseHandle(actor(u), id);
    return this.files.remove(actor(u), id);
  }
}
