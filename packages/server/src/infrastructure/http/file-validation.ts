export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/**
 * Validate a file buffer against MIME whitelist using magic bytes.
 * Falls back to declared MIME for text-based types where magic bytes detection fails.
 */
export async function validateFileMime(
  buffer: Buffer,
  declaredMime: string,
): Promise<{ valid: true; detectedMime: string } | { valid: false; reason: string }> {
  const { fileTypeFromBuffer } = await import('file-type');
  const result = await fileTypeFromBuffer(buffer);

  // file-type detected a type
  if (result) {
    if (!ALLOWED_MIME_TYPES.has(result.mime)) {
      return { valid: false, reason: `File type ${result.mime} is not allowed` };
    }
    return { valid: true, detectedMime: result.mime };
  }

  // file-type couldn't detect (text-based files have no magic bytes)
  const textMimes = new Set(['text/plain', 'text/csv']);
  if (textMimes.has(declaredMime) && ALLOWED_MIME_TYPES.has(declaredMime)) {
    return { valid: true, detectedMime: declaredMime };
  }

  return { valid: false, reason: `Could not verify file type (declared: ${declaredMime})` };
}
