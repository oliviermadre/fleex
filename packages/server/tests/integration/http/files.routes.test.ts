import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';

/**
 * `/api/files` is the attachment ingress used by the ticket UI. Two things make
 * it worth an integration test rather than a unit test on `validateFileMime`:
 *
 *   1. the MIME whitelist is enforced on the *magic bytes*, not on the
 *      `Content-Type` the client declares — so the check only exists once the
 *      multipart body has actually been parsed by `@fastify/multipart`;
 *   2. the download route sets `X-Content-Type-Options: nosniff`, which is the
 *      second half of that defence. Losing either half re-opens stored-XSS via
 *      an uploaded "image".
 *
 * No new npm dependency is allowed here, so the multipart bodies below are
 * assembled by hand. That is also a feature: the bytes on the wire are visible
 * in the test, so a change in how the server parses them cannot hide.
 */

const BOUNDARY = '----FleexTestBoundary7MA4YWxkTrZu0gW';
const CRLF = '\r\n';

/** `content-type` header matching the bodies produced below. */
const MULTIPART_HEADERS = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };

interface FilePart {
  /** Multipart field name. `request.file()` takes the first *file* part, whatever its name. */
  name?: string;
  filename: string;
  contentType: string;
  content: Buffer;
}

/** Builds a `multipart/form-data` body by hand: no extra dependency. */
function multipartBody(parts: {
  files?: FilePart[];
  fields?: Array<{ name: string; value: string }>;
}): Buffer {
  const chunks: Buffer[] = [];

  for (const field of parts.fields ?? []) {
    chunks.push(Buffer.from(
      `--${BOUNDARY}${CRLF}`
      + `Content-Disposition: form-data; name="${field.name}"${CRLF}${CRLF}`
      + `${field.value}${CRLF}`,
    ));
  }

  for (const file of parts.files ?? []) {
    chunks.push(Buffer.from(
      `--${BOUNDARY}${CRLF}`
      + `Content-Disposition: form-data; name="${file.name ?? 'file'}"; filename="${file.filename}"${CRLF}`
      + `Content-Type: ${file.contentType}${CRLF}${CRLF}`,
    ));
    chunks.push(file.content);
    chunks.push(Buffer.from(CRLF));
  }

  chunks.push(Buffer.from(`--${BOUNDARY}--${CRLF}`));
  return Buffer.concat(chunks);
}

/**
 * A real 1×1 transparent PNG. The first eight bytes are the PNG signature
 * (89 50 4E 47 0D 0A 1A 0A) that `validateFileMime` sniffs; the rest is a valid
 * IHDR/IDAT/IEND so the detection cannot be dismissed as a lucky prefix.
 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** GZIP magic bytes — a type the whitelist does not contain. */
const GZIP_BYTES = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]);

/** ELF magic bytes — an executable, the worst thing to accept. */
const ELF_BYTES = Buffer.concat([
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
  Buffer.alloc(56),
]);

async function uploadPng(h: TestAppHandle, filename = 'shot.png') {
  return h.app.inject({
    method: 'POST',
    url: '/api/files',
    headers: MULTIPART_HEADERS,
    payload: multipartBody({ files: [{ filename, contentType: 'image/png', content: PNG_1X1 }] }),
  });
}

describe('files routes', () => {
  let h: TestAppHandle;

  beforeEach(async () => {
    h = await createTestApp();
  });

  afterEach(async () => {
    await h.close();
  });

  describe('POST /api/files', () => {
    it('accepts a PNG and answers 200 with the id, url and sniffed mime type', async () => {
      const res = await uploadPng(h);

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        mimeType: 'image/png',
        originalName: 'shot.png',
        sizeBytes: PNG_1X1.length,
      });
      expect(body.id).toEqual(expect.any(String));
      expect(body.url).toBe(`/api/files/${body.id}`);

      // The metadata really landed in the store — the response is not a stub.
      const meta = await h.container.fileMetaStore.getById(body.id);
      expect(meta?.mimeType).toBe('image/png');
    });

    it('answers 400 when the multipart body carries no file part', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/files',
        headers: MULTIPART_HEADERS,
        payload: multipartBody({ fields: [{ name: 'ticketId', value: 'abc' }] }),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'No file provided' });
    });

    it('answers 400 on a gzip archive — not in the MIME whitelist', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/files',
        headers: MULTIPART_HEADERS,
        payload: multipartBody({
          files: [{ filename: 'blob.gz', contentType: 'application/gzip', content: GZIP_BYTES }],
        }),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('is not allowed');
    });

    /**
     * The declared `Content-Type` is attacker-controlled: an ELF renamed to
     * `.png` and announced as `image/png` must still be refused, because the
     * whitelist runs on the sniffed bytes. This is the case that justifies the
     * whole `validateFileMime` indirection.
     */
    it('answers 400 on an executable disguised as image/png', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/files',
        headers: MULTIPART_HEADERS,
        payload: multipartBody({
          files: [{ filename: 'innocent.png', contentType: 'image/png', content: ELF_BYTES }],
        }),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toEqual(expect.any(String));
    });

    it('answers 400 when nothing can be sniffed and the declared type is not text', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/files',
        headers: MULTIPART_HEADERS,
        payload: multipartBody({
          files: [{
            filename: 'mystery.bin',
            contentType: 'application/octet-stream',
            content: Buffer.from('no magic bytes here at all'),
          }],
        }),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Could not verify file type');
    });

    /**
     * ⚠️  KNOWN BUG, LOCKED ON PURPOSE.
     *
     * The route contains `if (buffer.length > MAX_FILE_SIZE) return 413`, but
     * that line is unreachable: `@fastify/multipart` is registered with
     * `limits: { fileSize: 10 * 1024 * 1024 }`, so `data.toBuffer()` rejects
     * with `FST_REQ_FILE_TOO_LARGE` (statusCode 413) BEFORE the comparison ever
     * runs. The route does not catch it, and `registerErrorHandler` discards
     * `error.statusCode` for anything that is not a `DomainError` — so the
     * client sees
     *   500 { error: 'INTERNAL_ERROR', message: 'request file too large' }.
     *
     * It should be 413 with the route's own message. Same root cause as the
     * validation-status bug locked in hook.routes.test.ts: the error handler
     * flattens every non-domain error to 500. Fixing it is its own ticket; the
     * lock keeps the fix a visible red→green diff.
     */
    it('answers 500 on a >10 MB upload (should be 413 — see comment)', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/files',
        headers: MULTIPART_HEADERS,
        payload: multipartBody({
          files: [{
            filename: 'huge.png',
            contentType: 'image/png',
            content: Buffer.concat([PNG_1X1, Buffer.alloc(11 * 1024 * 1024, 0x41)]),
          }],
        }),
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({
        error: 'INTERNAL_ERROR',
        message: 'request file too large',
      });
    });

    /**
     * Text files have no magic bytes, so `validateFileMime` falls back to the
     * declared MIME — but only for the two text types on the whitelist. That
     * fallback is the one place where the client is trusted; pin it.
     */
    it('accepts text/plain through the declared-mime fallback', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/files',
        headers: MULTIPART_HEADERS,
        payload: multipartBody({
          files: [{ filename: 'notes.txt', contentType: 'text/plain', content: Buffer.from('hello') }],
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ mimeType: 'text/plain', originalName: 'notes.txt' });
    });
  });

  describe('GET /api/files/:id', () => {
    it('serves the stored bytes with the recorded content-type and nosniff', async () => {
      const upload = await uploadPng(h);
      expect(upload.statusCode).toBe(200);
      const { id } = upload.json();

      const res = await h.app.inject({ method: 'GET', url: `/api/files/${id}` });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      // Images render in place; anything else is forced to download.
      expect(res.headers['content-disposition']).toBe('inline');
      expect(res.rawPayload.equals(PNG_1X1)).toBe(true);
    });

    it('forces a download for a non-image, quoting the original filename', async () => {
      const upload = await h.app.inject({
        method: 'POST',
        url: '/api/files',
        headers: MULTIPART_HEADERS,
        payload: multipartBody({
          files: [{ filename: 'report.txt', contentType: 'text/plain', content: Buffer.from('body') }],
        }),
      });
      expect(upload.statusCode).toBe(200);

      const res = await h.app.inject({ method: 'GET', url: `/api/files/${upload.json().id}` });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-disposition']).toBe('attachment; filename="report.txt"');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('answers 404 for an unknown id', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/files/00000000-0000-4000-8000-000000000000',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'File not found' });
    });

    it('answers 404 for an id that is not even a uuid', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/files/not-a-uuid' });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'File not found' });
    });
  });
});
