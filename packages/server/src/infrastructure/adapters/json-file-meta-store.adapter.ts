import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import { FileMetadataEntity } from '../../domain/entities/file-metadata.entity.js';
import type { FileMetaStorePort } from '../../application/ports/file-meta-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

interface SerializedFile {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export class JsonFileMetaStore implements FileMetaStorePort {
  private readonly files = new Map<string, FileMetadataEntity>();
  private readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, 'projects', 'files.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadFromDisk();
    this.initialized = true;
  }

  async getById(id: string): Promise<FileMetadataEntity | null> {
    return this.files.get(id) ?? null;
  }

  async save(meta: FileMetadataEntity): Promise<void> {
    this.files.set(meta.id, meta);
    await this.syncToDisk();
  }

  async remove(id: string): Promise<void> {
    this.files.delete(id);
    await this.syncToDisk();
  }

  async getTotalSizeBytes(): Promise<number> {
    let total = 0;
    for (const f of this.files.values()) total += f.sizeBytes;
    return total;
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as SerializedFile[];
      for (const f of data) {
        this.files.set(f.id, new FileMetadataEntity(
          f.id, f.originalName, f.mimeType, f.sizeBytes, new Date(f.createdAt),
        ));
      }
      this.logger.info('File meta store loaded', { count: this.files.size });
    } catch (err) {
      this.logger.warn('Failed to load file metadata from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncToDisk(): Promise<void> {
    try {
      const data: SerializedFile[] = Array.from(this.files.values()).map((f) => ({
        id: f.id, originalName: f.originalName, mimeType: f.mimeType,
        sizeBytes: f.sizeBytes, createdAt: f.createdAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync file metadata to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
