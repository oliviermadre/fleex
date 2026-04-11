import type { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import type { PersonaStorePort } from '../../application/ports/persona-store.port.js';

/**
 * Write-through in-memory cache over any PersonaStorePort.
 * Hot path (getAll, getById, getByName) never touches the DB.
 */
export class CachedPersonaStore implements PersonaStorePort {
  private byId = new Map<string, AgentPersonaEntity>();
  private byName = new Map<string, AgentPersonaEntity>();
  private warmedUp = false;

  constructor(private readonly inner: PersonaStorePort) {}

  async warmUp(): Promise<void> {
    const all = await this.inner.getAll();
    this.byId.clear();
    this.byName.clear();
    for (const p of all) {
      this.byId.set(p.id, p);
      this.byName.set(p.name, p);
    }
    this.warmedUp = true;
  }

  private async ensureWarmed(): Promise<void> {
    if (!this.warmedUp) await this.warmUp();
  }

  async getAll(): Promise<AgentPersonaEntity[]> {
    await this.ensureWarmed();
    return [...this.byId.values()];
  }

  async getById(id: string): Promise<AgentPersonaEntity | null> {
    await this.ensureWarmed();
    return this.byId.get(id) ?? null;
  }

  async getByName(name: string): Promise<AgentPersonaEntity | null> {
    await this.ensureWarmed();
    return this.byName.get(name) ?? null;
  }

  async save(persona: AgentPersonaEntity): Promise<void> {
    await this.inner.save(persona);
    // If name changed, remove old name entry
    const existing = this.byId.get(persona.id);
    if (existing && existing.name !== persona.name) {
      this.byName.delete(existing.name);
    }
    this.byId.set(persona.id, persona);
    this.byName.set(persona.name, persona);
  }

  async remove(id: string): Promise<void> {
    const persona = this.byId.get(id);
    await this.inner.remove(id);
    if (persona) {
      this.byId.delete(id);
      this.byName.delete(persona.name);
    }
  }
}
