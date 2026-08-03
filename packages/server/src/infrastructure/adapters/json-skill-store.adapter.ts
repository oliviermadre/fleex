import { join } from 'node:path';

import { FLEEX_DIR } from '@fleex/shared';

import { SkillEntity } from '../../domain/entities/skill.entity.js';

import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { SkillStorePort } from '../../application/ports/skill-store.port.js';
import type { HostFs } from '../host/types.js';

interface SerializedSkill {
  id: string;
  commandName: string;
  name: string;
  displayName: string;
  markdownContent: string;
  enabled: boolean;
  personaId: string;
  createdAt: string;
  updatedAt: string;
}

export class JsonSkillStore implements SkillStorePort {
  private readonly skills = new Map<string, SkillEntity>();
  private readonly filePath: string;
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.filePath = join(this.homedir, FLEEX_DIR, 'projects', 'skills.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadFromDisk();
    this.initialized = true;
  }

  async getAll(): Promise<SkillEntity[]> {
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getById(id: string): Promise<SkillEntity | null> {
    return this.skills.get(id) ?? null;
  }

  async getByCommandName(commandName: string): Promise<SkillEntity | null> {
    for (const skill of this.skills.values()) {
      if (skill.commandName === commandName) return skill;
    }
    return null;
  }

  async getEnabled(): Promise<SkillEntity[]> {
    return Array.from(this.skills.values())
      .filter((s) => s.enabled)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async save(skill: SkillEntity): Promise<void> {
    this.skills.set(skill.id, skill);
    await this.syncToDisk();
  }

  async remove(id: string): Promise<void> {
    this.skills.delete(id);
    await this.syncToDisk();
  }

  private async loadFromDisk(): Promise<void> {
    if (!(await this.hostFs.exists(this.filePath))) return;
    try {
      const raw = await this.hostFs.readFile(this.filePath);
      const data = JSON.parse(raw) as SerializedSkill[];
      for (const s of data) {
        this.skills.set(
          s.id,
          new SkillEntity(
            s.id,
            s.commandName,
            s.name,
            s.displayName,
            s.markdownContent,
            s.enabled,
            s.personaId,
            new Date(s.createdAt),
            new Date(s.updatedAt),
          ),
        );
      }
      this.logger.info('Skill store loaded', { count: this.skills.size });
    } catch (err) {
      this.logger.warn('Failed to load skills from disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncToDisk(): Promise<void> {
    try {
      const data: SerializedSkill[] = Array.from(this.skills.values()).map((s) => ({
        id: s.id,
        commandName: s.commandName,
        name: s.name,
        displayName: s.displayName,
        markdownContent: s.markdownContent,
        enabled: s.enabled,
        personaId: s.personaId,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      }));
      await this.hostFs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync skills to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
