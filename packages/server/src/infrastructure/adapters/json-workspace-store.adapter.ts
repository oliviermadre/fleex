import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import type { Workspace } from '@fleex/shared';
import type { WorkspaceStorePort } from '../../application/ports/workspace-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

const WORKSPACES_FILE = 'workspaces.json';

export class JsonWorkspaceStore implements WorkspaceStorePort {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, WORKSPACES_FILE);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const dir = join(this.homedir, FLEEX_DIR);
    if (!(await this.hostFs.exists(dir))) {
      await this.hostFs.mkdir(dir);
    }
    await this.loadFromDisk();
    this.initialized = true;
  }

  async save(workspace: Workspace): Promise<void> {
    await this.init();
    this.workspaces.set(workspace.ticketId, workspace);
    await this.syncToDisk();
  }

  async remove(ticketId: string): Promise<void> {
    await this.init();
    this.workspaces.delete(ticketId);
    await this.syncToDisk();
  }

  async getByTicketId(ticketId: string): Promise<Workspace | null> {
    await this.init();
    return this.workspaces.get(ticketId) ?? null;
  }

  async getAll(): Promise<Workspace[]> {
    await this.init();
    return Array.from(this.workspaces.values());
  }

  private async loadFromDisk(): Promise<void> {
    try {
      if (!(await this.hostFs.exists(this.filePath))) return;
      const raw = await this.hostFs.readFile(this.filePath);
      const data: Workspace[] = JSON.parse(raw);
      for (const ws of data) {
        this.workspaces.set(ws.ticketId, ws);
      }
    } catch (err) {
      this.logger.warn('Failed to load workspaces from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncToDisk(): Promise<void> {
    try {
      const data = Array.from(this.workspaces.values());
      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.warn('Failed to sync workspaces to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
