/**
 * Minimal magic-byte sniffing for the four types the app accepts. Used to reject
 * an upload whose real bytes do not match its declared multipart content-type
 * (e.g. an HTML file sent as image/png).
 */
export type AllowedMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';

function startsWith(buf: Buffer, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}

/** The mime implied by the leading bytes, or null if it is none of the four. */
export function sniffMime(buf: Buffer): AllowedMime | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // RIFF....WEBP
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && buf.length >= 12 && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  return null;
}

/** True when the bytes match the declared type. */
export function contentMatchesDeclared(buf: Buffer, declared: string): boolean {
  return sniffMime(buf) === declared;
}
