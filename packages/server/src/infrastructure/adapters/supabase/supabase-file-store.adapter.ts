import { Readable } from 'node:stream';
import type { FileStorePort } from '../../../application/ports/file-store.port.js';
import type { SupabaseConnection } from './connection.js';

const BUCKET = 'files';

export class SupabaseFileStoreAdapter implements FileStorePort {
  private bucketReady = false;

  constructor(private readonly conn: SupabaseConnection) {}

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    if (this.conn.canExecuteDDL) {
      // Direct SQL bypasses RLS on storage.buckets
      await this.conn.query(
        `INSERT INTO storage.buckets (id, name, public) VALUES ($1, $1, false) ON CONFLICT (id) DO NOTHING`,
        [BUCKET],
      );
    } else {
      // Fallback to Storage API — requires permissive RLS on storage.buckets
      const { error } = await this.conn.client.storage.createBucket(BUCKET, { public: false });
      if (error && !error.message.includes('already exists')) {
        throw new Error(`SupabaseFileStore.ensureBucket failed: ${error.message}`);
      }
    }
    this.bucketReady = true;
  }

  async save(id: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.ensureBucket();
    const { error } = await this.conn.client.storage
      .from(BUCKET)
      .upload(id, buffer, { contentType: mimeType, upsert: false });
    if (error) throw new Error(`SupabaseFileStore.save failed: ${error.message}`);
  }

  async getBuffer(id: string): Promise<Buffer | null> {
    const { data, error } = await this.conn.client.storage
      .from(BUCKET)
      .download(id);
    if (error || !data) return null;
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async getStream(id: string): Promise<Readable | null> {
    const { data, error } = await this.conn.client.storage
      .from(BUCKET)
      .download(id);
    if (error || !data) return null;
    const arrayBuffer = await data.arrayBuffer();
    return Readable.from(Buffer.from(arrayBuffer));
  }

  async getSignedUrl(id: string): Promise<string> {
    const { data, error } = await this.conn.client.storage
      .from(BUCKET)
      .createSignedUrl(id, 3600);
    if (error || !data?.signedUrl) {
      throw new Error(`SupabaseFileStore.getSignedUrl failed: ${error?.message ?? 'no URL'}`);
    }
    return data.signedUrl;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.conn.client.storage
      .from(BUCKET)
      .remove([id]);
    if (error) throw new Error(`SupabaseFileStore.remove failed: ${error.message}`);
  }
}
