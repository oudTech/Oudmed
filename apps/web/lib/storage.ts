import { api } from './api'
import type { StoredFileDTO } from '@oudhealth/contracts'

export type UploadCategory = 'PHOTO' | 'DOCUMENT' | 'LOGO' | 'RESULT' | 'OTHER'

/** Generic upload to /files. Returns the stored-file record (with a stable /api/files/:id url). */
export async function uploadFile(file: File, category: UploadCategory): Promise<StoredFileDTO> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('category', category)
  const res = await api.post<StoredFileDTO>('/files', fd)
  return res.data
}

export const ACCEPTED_UPLOAD = 'image/png,image/jpeg,image/webp,application/pdf'
export const MAX_UPLOAD_MB = 20

export function uploadError(e: unknown): string {
  const m = (e as any)?.response?.data?.message
  return typeof m === 'string' ? m : 'Upload failed.'
}
