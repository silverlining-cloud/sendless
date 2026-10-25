import { MAX_PARTS, MiB, MIN_PART_SIZE } from '@s3ndless/shared';

/** Smallest part size (whole MiB, at least 8 MiB) that fits the file into S3's 10,000-part limit. */
export function planParts(size: number): { partSize: number; partCount: number } {
  const needed = Math.ceil(size / MAX_PARTS);
  const partSize = Math.max(MIN_PART_SIZE, Math.ceil(needed / MiB) * MiB);
  return { partSize, partCount: Math.max(1, Math.ceil(size / partSize)) };
}

/**
 * Neutralises path separators and control characters in a client-supplied file name.
 * Storage keys never contain names, so this only protects what recipients' browsers see.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 255) : 'file';
}

/**
 * RFC 6266 `Content-Disposition` with an ASCII fallback and an RFC 5987 UTF-8 `filename*`.
 * Quotes and backslashes never reach the quoted fallback, so the header cannot be broken out of.
 */
export function contentDisposition(fileName: string): string {
  const name = sanitizeFileName(fileName);
  const fallback =
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\%;]/g, '_') || 'download';
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Only allow well-formed MIME types; anything else is served as a generic binary. */
export function safeContentType(contentType: string): string {
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(contentType) ? contentType.toLowerCase() : 'application/octet-stream';
}
