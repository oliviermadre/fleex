import { FileMetadataEntity } from '../../../domain/entities/file-metadata.entity.js';
import type { FileMetaStorePort } from '../../../application/ports/file-meta-store.port.js';
import type { SupabaseConnection } from './connection.js';

interface FileRow {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

function rowToEntity(r: FileRow): FileMetadataEntity {
  return new FileMetadataEntity(
    r.id,
    r.original_name,
    r.mime_type,
    r.size_bytes,
    new Date(r.created_at),
  );
}

export class SupabaseFileMetaStore implements FileMetaStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getById(id: string): Promise<FileMetadataEntity | null> {
    const { data, error } = await this.conn.client
      .from('files')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseFileMetaStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as FileRow) : null;
  }

  async save(meta: FileMetadataEntity): Promise<void> {
    const { error } = await this.conn.client.from('files').upsert({
      id: meta.id,
      original_name: meta.originalName,
      mime_type: meta.mimeType,
      size_bytes: meta.sizeBytes,
      created_at: meta.createdAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseFileMetaStore.save failed: ${error.message}`);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.conn.client
      .from('files')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`SupabaseFileMetaStore.remove failed: ${error.message}`);
  }

  async getTotalSizeBytes(): Promise<number> {
    // Supabase doesn't support SUM via the JS client — use RPC or raw query
    const { data, error } = await this.conn.client
      .from('files')
      .select('size_bytes');
    if (error) throw new Error(`SupabaseFileMetaStore.getTotalSizeBytes failed: ${error.message}`);
    return (data as { size_bytes: number }[]).reduce((sum, r) => sum + r.size_bytes, 0);
  }
}
