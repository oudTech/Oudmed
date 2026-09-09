export type FileCategory = 'PHOTO' | 'DOCUMENT' | 'LOGO' | 'RESULT' | 'OTHER'

export interface StoredFileDTO {
  id: string
  /** Stable API path (`/api/files/<id>`); redirects to a fresh presigned URL. */
  url: string
  originalName: string
  mimeType: string
  size: number
  category: string
  createdAt: string
}
