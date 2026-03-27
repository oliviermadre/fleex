import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import type { PanelMember } from '@fleex/shared';
import { PanelEntity } from '../../domain/entities/panel.entity.js';
import type { PanelStorePort } from '../../application/ports/panel-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

interface SerializedPanel {
  id: string;
  name: string;
  displayName: string;
  description: string;
  executionMode?: string;
  members: PanelMember[];
  orchestratorPrompt: string;
  orchestratorModel: string;
  orchestratorPersonaId: string | null;
  defaultMemberModel: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export class JsonPanelStore implements PanelStorePort {
  private readonly panels = new Map<string, PanelEntity>();
  private readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, 'projects', 'panels.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadFromDisk();
    this.initialized = true;
  }

  async getAll(): Promise<PanelEntity[]> {
    return Array.from(this.panels.values())
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getById(id: string): Promise<PanelEntity | null> {
    return this.panels.get(id) ?? null;
  }

  async getByName(name: string): Promise<PanelEntity | null> {
    for (const panel of this.panels.values()) {
      if (panel.name === name) return panel;
    }
    return null;
  }

  async getEnabled(): Promise<PanelEntity[]> {
    return Array.from(this.panels.values())
      .filter((p) => p.enabled)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async save(panel: PanelEntity): Promise<void> {
    this.panels.set(panel.id, panel);
    await this.syncToDisk();
  }

  async remove(id: string): Promise<void> {
    this.panels.delete(id);
    await this.syncToDisk();
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as SerializedPanel[];
      for (const p of data) {
        this.panels.set(p.id, new PanelEntity(
          p.id, p.name, p.displayName, p.description,
          (p.executionMode ?? 'claude_code') as 'claude_code' | 'message',
          p.members, p.orchestratorPrompt, p.orchestratorModel,
          p.orchestratorPersonaId ?? null, p.defaultMemberModel, p.enabled,
          new Date(p.createdAt), new Date(p.updatedAt),
        ));
      }
      this.logger.info('Panel store loaded', { count: this.panels.size });
    } catch (err) {
      this.logger.warn('Failed to load panels from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncToDisk(): Promise<void> {
    try {
      const data: SerializedPanel[] = Array.from(this.panels.values()).map((p) => ({
        id: p.id, name: p.name, displayName: p.displayName, description: p.description,
        executionMode: p.executionMode,
        members: p.members, orchestratorPrompt: p.orchestratorPrompt,
        orchestratorModel: p.orchestratorModel, orchestratorPersonaId: p.orchestratorPersonaId,
        defaultMemberModel: p.defaultMemberModel,
        enabled: p.enabled,
        createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync panels to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
