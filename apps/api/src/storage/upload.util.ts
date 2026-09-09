import { FileInterceptor } from '@nestjs/platform-express';

/**
 * Single source of truth for the multipart upload ceiling. Enforced by multer
 * (it stops buffering at the limit and @nestjs/platform-express maps the
 * resulting error to HTTP 413) and again in FilesService as defence in depth.
 */
export const MAX_UPLOAD_MB = Number(process.env.FILE_MAX_MB) || 20;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export const uploadLimits = { fileSize: MAX_UPLOAD_BYTES, files: 1 } as const;

/** FileInterceptor with the memory + count caps applied. Use everywhere a file is accepted. */
export const uploadInterceptor = (field = 'file') =>
  FileInterceptor(field, { limits: { ...uploadLimits } });
