import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import type { PersonaStorePort } from '../../application/ports/persona-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

interface SerializedPersona {
  id: string;
  name: string;
  displayName: string;
  model: string;
  soulMd: string;
  identityMd: string;
  memoryMd: string;
  humanMentionName: string | null;
  createdAt: string;
  updatedAt: string;
}

export class JsonPersonaStore implements PersonaStorePort {
  private readonly personas = new Map<string, AgentPersonaEntity>();
  private readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, 'projects', 'personas.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.loadFromDisk();
      this.initialized = true;
    } catch {
      // Gateway tunnel may not be connected yet — will retry on next operation.
    }
  }

  async getAll(): Promise<AgentPersonaEntity[]> {
    return Array.from(this.personas.values())
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getById(id: string): Promise<AgentPersonaEntity | null> {
    return this.personas.get(id) ?? null;
  }

  async getByName(name: string): Promise<AgentPersonaEntity | null> {
    for (const persona of this.personas.values()) {
      if (persona.name === name) return persona;
    }
    return null;
  }

  async save(persona: AgentPersonaEntity): Promise<void> {
    this.personas.set(persona.id, persona);
    await this.syncToDisk();
  }

  async remove(id: string): Promise<void> {
    this.personas.delete(id);
    await this.syncToDisk();
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as SerializedPersona[];
      for (const p of data) {
        this.personas.set(p.id, new AgentPersonaEntity(
          p.id, p.name, p.displayName, p.model,
          p.soulMd, p.identityMd, p.memoryMd,
          p.humanMentionName,
          new Date(p.createdAt), new Date(p.updatedAt),
        ));
      }
      this.logger.info('Persona store loaded', { count: this.personas.size });
    } catch (err) {
      this.logger.warn('Failed to load personas from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncToDisk(): Promise<void> {
    try {
      const data: SerializedPersona[] = Array.from(this.personas.values()).map((p) => ({
        id: p.id, name: p.name, displayName: p.displayName, model: p.model,
        soulMd: p.soulMd, identityMd: p.identityMd, memoryMd: p.memoryMd,
        humanMentionName: p.humanMentionName,
        createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync personas to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
