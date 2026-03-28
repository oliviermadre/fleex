import type { FileMetadataEntity } from '../../domain/entities/file-metadata.entity.js';

/**
 * Metadata CRUD for uploaded files (DB rows).
 */
export interface FileMetaStorePort {
  save(meta: FileMetadataEntity): Promise<void>;
  getById(id: string): Promise<FileMetadataEntity | null>;
  remove(id: string): Promise<void>;
  getTotalSizeBytes(): Promise<number>;
}
