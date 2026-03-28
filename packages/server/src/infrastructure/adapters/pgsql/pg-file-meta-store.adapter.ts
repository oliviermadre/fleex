import { FileMetadataEntity } from '../../../domain/entities/file-metadata.entity.js';
import type { FileMetaStorePort } from '../../../application/ports/file-meta-store.port.js';
import type { PgConnection } from './connection.js';

export class PgFileMetaStore implements FileMetaStorePort {
  constructor(private readonly db: PgConnection) {}

  async getById(id: string): Promise<FileMetadataEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM files WHERE id = $1', [id]);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async save(meta: FileMetadataEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO files (id, original_name, mime_type, size_bytes, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         original_name = $2, mime_type = $3, size_bytes = $4, created_at = $5`,
      [meta.id, meta.originalName, meta.mimeType, meta.sizeBytes, meta.createdAt.toISOString()],
    );
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE FROM files WHERE id = $1', [id]);
  }

  async getTotalSizeBytes(): Promise<number> {
    const { rows } = await this.db.query('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM files');
    return Number(rows[0]?.total ?? 0);
  }
}

function rowToEntity(row: Record<string, unknown>): FileMetadataEntity {
  return new FileMetadataEntity(
    row.id as string,
    row.original_name as string,
    row.mime_type as string,
    Number(row.size_bytes),
    new Date(row.created_at as string),
  );
}
