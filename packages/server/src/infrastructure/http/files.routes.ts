import { randomUUID } from 'node:crypto';

import { FileMetadataEntity } from '../../domain/entities/file-metadata.entity.js';

import { MAX_FILE_SIZE, validateFileMime } from './file-validation.js';

import type { Container } from '../container.js';
import type { FastifyInstance } from 'fastify';

export function fileRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    // POST /api/files — multipart upload
    app.post('/api/files', async (request, reply) => {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: 'No file provided' });
      }

      const buffer = await data.toBuffer();

      if (buffer.length > MAX_FILE_SIZE) {
        return reply.code(413).send({ error: 'File too large (max 10 MB)' });
      }

      const declaredMime = data.mimetype;
      const validation = await validateFileMime(buffer, declaredMime);
      if (!validation.valid) {
        return reply.code(400).send({ error: validation.reason });
      }

      const id = randomUUID();
      const mimeType = validation.detectedMime;
      const originalName = data.filename || 'file';

      await container.fileStore.save(id, buffer, mimeType);

      const entity = FileMetadataEntity.create({
        id,
        originalName,
        mimeType,
        sizeBytes: buffer.length,
      });
      await container.fileMetaStore.save(entity);

      return {
        id,
        url: `/api/files/${id}`,
        originalName,
        mimeType,
        sizeBytes: buffer.length,
      };
    });

    // GET /api/files/:id — serve or redirect
    app.get<{ Params: { id: string } }>('/api/files/:id', async (request, reply) => {
      const meta = await container.fileMetaStore.getById(request.params.id);
      if (!meta) {
        return reply.code(404).send({ error: 'File not found' });
      }

      // Supabase driver: redirect to signed URL
      if (container.fileStore.getSignedUrl) {
        const url = await container.fileStore.getSignedUrl(meta.id);
        return reply.redirect(url);
      }

      // Disk driver: stream the file
      const stream = await container.fileStore.getStream(meta.id);
      if (!stream) {
        return reply.code(404).send({ error: 'File not found on disk' });
      }

      const isImage = meta.mimeType.startsWith('image/');
      const disposition = isImage ? 'inline' : `attachment; filename="${meta.originalName}"`;

      return reply
        .type(meta.mimeType)
        .header('Content-Disposition', disposition)
        .header('X-Content-Type-Options', 'nosniff')
        .send(stream);
    });
  };
}
