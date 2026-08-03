import { FileMetadataEntity } from '../../../domain/entities/file-metadata.entity.js';

import type { SqliteConnection } from './connection.js';
import type { FileMetaStorePort } from '../../../application/ports/file-meta-store.port.js';

interface FileRow {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export class SqliteFileMetaStoreAdapter implements FileMetaStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getById(id: string): Promise<FileMetadataEntity | null> {
    const row = this.conn.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as
      FileRow | undefined;
    return row ? toEntity(row) : null;
  }

  async save(meta: FileMetadataEntity): Promise<void> {
    this.conn.db
      .prepare(
        `
      INSERT OR REPLACE INTO files
        (id, original_name, mime_type, size_bytes, created_at)
      VALUES
        (@id, @original_name, @mime_type, @size_bytes, @created_at)
    `,
      )
      .run({
        id: meta.id,
        original_name: meta.originalName,
        mime_type: meta.mimeType,
        size_bytes: meta.sizeBytes,
        created_at: meta.createdAt.toISOString(),
      });
  }

  async remove(id: string): Promise<void> {
    this.conn.db.prepare('DELETE FROM files WHERE id = ?').run(id);
  }

  async getTotalSizeBytes(): Promise<number> {
    const row = this.conn.db
      .prepare('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM files')
      .get() as { total: number };
    return row.total;
  }
}

function toEntity(row: FileRow): FileMetadataEntity {
  return new FileMetadataEntity(
    row.id,
    row.original_name,
    row.mime_type,
    row.size_bytes,
    new Date(row.created_at),
  );
}
