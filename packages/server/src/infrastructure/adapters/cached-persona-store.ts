import type { PersonaStorePort } from '../../application/ports/persona-store.port.js';
import type { RemoteCacheSync } from '../../application/ports/remote-cache-sync.port.js';
import type { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import type { AnyDomainEvent } from '../../domain/events.js';

/**
 * Write-through in-memory cache over any PersonaStorePort.
 * Hot path (getAll, getById, getByName) never touches the DB.
 */
export class CachedPersonaStore implements PersonaStorePort, RemoteCacheSync {
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

  // ── Cross-instance cache coherence (RemoteCacheSync) ──
  // A sibling instance wrote a persona to the shared store and forwarded the
  // event over the hub. Re-read it from source before the event is broadcast.

  async applyRemoteEvent(event: AnyDomainEvent): Promise<void> {
    if (event.type.startsWith('persona.') && 'personaId' in event) {
      await this.refresh((event as { personaId: string }).personaId);
    }
  }

  private async refresh(id: string): Promise<void> {
    const existing = this.byId.get(id);
    const fresh = await this.inner.getById(id);
    if (fresh) {
      if (existing && existing.name !== fresh.name) this.byName.delete(existing.name);
      this.byId.set(id, fresh);
      this.byName.set(fresh.name, fresh);
    } else if (existing) {
      this.byId.delete(id);
      this.byName.delete(existing.name);
    }
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
