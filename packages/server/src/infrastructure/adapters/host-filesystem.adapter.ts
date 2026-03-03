import type { FileSystemPort } from '../../application/ports/filesystem.port.js';
import type { HostFs } from '../host/types.js';

export class HostFileSystemAdapter implements FileSystemPort {
  constructor(private readonly hostFs: HostFs) {}

  async exists(path: string): Promise<boolean> {
    return this.hostFs.exists(path);
  }
}
