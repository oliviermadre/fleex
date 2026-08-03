import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { FLEEX_DIR } from '@fleex/shared';

import type { FileStorePort } from '../../application/ports/file-store.port.js';
import type { Readable } from 'node:stream';

export class DiskFileStoreAdapter implements FileStorePort {
  private readonly dir: string;

  constructor(homedir: string) {
    this.dir = join(homedir, FLEEX_DIR, 'files');
  }

  async save(id: string, buffer: Buffer, _mimeType: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, id), buffer);
  }

  async getBuffer(id: string): Promise<Buffer | null> {
    try {
      return await readFile(join(this.dir, id));
    } catch {
      return null;
    }
  }

  async getStream(id: string): Promise<Readable | null> {
    const path = join(this.dir, id);
    try {
      return createReadStream(path);
    } catch {
      return null;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await unlink(join(this.dir, id));
    } catch {
      // File may already be deleted — acceptable
    }
  }
}
