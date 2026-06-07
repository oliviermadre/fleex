import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import type { StatusModel } from '@fleex/shared';
import type { StatusModelStorePort } from '../../application/ports/status-model-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

/**
 * File-backed status model for the JSON driver (the default install). Returns
 * null when no file exists yet, so callers fall back to DEFAULT_STATUS_MODEL.
 */
export class JsonStatusModelStore implements StatusModelStorePort {
  private readonly filePath: string;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, 'status-columns.json');
  }

  async getModel(): Promise<StatusModel | null> {
    if (!(await this.hostFs.exists(this.filePath))) return null;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      return JSON.parse(raw) as StatusModel;
    } catch (err) {
      this.logger.warn('Failed to load status model from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async saveModel(model: StatusModel): Promise<void> {
    await this.hostFs.writeFile(this.filePath, JSON.stringify(model, null, 2));
  }
}
