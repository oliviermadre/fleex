import type { Readable } from 'node:stream';

/**
 * Physical blob storage for uploaded files (disk or Supabase Storage).
 */
export interface FileStorePort {
  save(id: string, buffer: Buffer, mimeType: string): Promise<void>;
  getStream(id: string): Promise<Readable | null>;
  getBuffer(id: string): Promise<Buffer | null>;
  getSignedUrl?(id: string): Promise<string>;
  remove(id: string): Promise<void>;
}
