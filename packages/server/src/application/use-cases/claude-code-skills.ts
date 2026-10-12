import { randomUUID } from 'node:crypto';
import type { ClaudeCodeSkillScanReport, Skill, UpdateClaudeCodeSkillRequest } from '@fleex/shared';
import type { ClaudeCodeSkillEntity } from '../../domain/entities/claude-code-skill.entity.js';
import {
  CLAUDE_CODE_SYSTEM_PERSONA_NAME,
  isReservedCommandName,
  reconcileScan,
  resolveClaudeCodeSkill,
} from '../../domain/services/claude-code-skills.js';
import {
  AgentPersonaNotFoundError,
  ClaudeCodeSkillNotActivatableError,
  ClaudeCodeSkillNotFoundError,
} from '../../domain/errors.js';
import type { ClaudeCodeSkillStorePort } from '../ports/claude-code-skill-store.port.js';
import type { SkillStorePort } from '../ports/skill-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { ClaudeCodeSkillScanner } from '../services/claude-code-skill-scanner.js';

/**
 * Everything Fleex does with Claude Code skills, always for the machine this
 * server runs on (`hostId`): rows of other machines sharing the database are
 * never read, listed or run here.
 */
export class ClaudeCodeSkillsUseCase {
  private scanning: Promise<ClaudeCodeSkillScanReport> | null = null;

  constructor(
    private readonly store: ClaudeCodeSkillStorePort,
    private readonly scanner: ClaudeCodeSkillScanner,
    private readonly skillStore: SkillStorePort,
    private readonly personaStore: PersonaStorePort,
    private readonly ticketStore: TicketStorePort,
    readonly hostId: string,
    private readonly logger: LoggerPort,
  ) {}

  /** Concurrent callers (boot + button + CLI) share one scan. */
  scan(): Promise<ClaudeCodeSkillScanReport> {
    this.scanning ??= this.runScan().finally(() => { this.scanning = null; });
    return this.scanning;
  }

  private async runScan(): Promise<ClaudeCodeSkillScanReport> {
    const [discovered, existing, natives] = await Promise.all([
      this.scanner.scan(),
      this.store.listByHost(this.hostId),
      this.skillStore.getAll(),
    ]);
    const nativeCommandNames = new Set(natives.map((s) => s.commandName).filter(isReservedCommandName));
    const { rows, report } = reconcileScan({
      hostId: this.hostId, existing, discovered, nativeCommandNames, now: new Date(), newId: randomUUID,
    });
    await this.store.saveMany(rows);
    this.logger.info('Claude Code skills scanned', { ...report });
    return report;
  }

  list(): Promise<ClaudeCodeSkillEntity[]> {
    return this.store.listByHost(this.hostId);
  }

  async get(id: string): Promise<ClaudeCodeSkillEntity> {
    const skill = await this.store.getById(id);
    if (!skill || skill.hostId !== this.hostId) throw new ClaudeCodeSkillNotFoundError(id);
    return skill;
  }

  async update(id: string, req: UpdateClaudeCodeSkillRequest): Promise<ClaudeCodeSkillEntity> {
    const skill = await this.get(id);
    if (req.personaId !== undefined) {
      if (req.personaId !== null && !(await this.personaStore.getById(req.personaId))) {
        throw new AgentPersonaNotFoundError(req.personaId);
      }
      skill.setPersona(req.personaId);
    }
    if (req.enabled !== undefined) {
      if (req.enabled && !skill.activatable) throw new ClaudeCodeSkillNotActivatableError(skill.commandName, skill.status);
      skill.setEnabled(req.enabled);
    }
    if (req.revalidate) skill.revalidate();
    await this.store.saveMany([skill]);
    return skill;
  }

  /** Bulk toggle. Non-activatable rows are skipped, not failed. */
  async setEnabled(ids: string[], enabled: boolean): Promise<ClaudeCodeSkillEntity[]> {
    const wanted = new Set(ids);
    const changed = (await this.list())
      .filter((s) => wanted.has(s.id) && (!enabled || s.activatable) && s.enabled !== enabled);
    changed.forEach((s) => s.setEnabled(enabled));
    await this.store.saveMany(changed);
    return changed;
  }

  async readContent(id: string): Promise<string> {
    return this.scanner.readContent(await this.get(id));
  }

  async systemPersonaId(): Promise<string | null> {
    return (await this.personaStore.getByName(CLAUDE_CODE_SYSTEM_PERSONA_NAME))?.id ?? null;
  }

  /** Persona that runs this skill: the override, else the system persona. */
  async effectivePersonaId(skill: ClaudeCodeSkillEntity): Promise<string> {
    if (skill.personaId && (await this.personaStore.getById(skill.personaId))) return skill.personaId;
    const systemId = await this.systemPersonaId();
    if (!systemId) throw new AgentPersonaNotFoundError(CLAUDE_CODE_SYSTEM_PERSONA_NAME);
    return systemId;
  }

  /**
   * Runnable skills of this host in the native skill shape, for `GET /api/skills`.
   * Project skills are all returned with their `repo`: the client filters them
   * per ticket, as it is the one that knows which ticket is on screen.
   */
  async listAsSkills(): Promise<Skill[]> {
    const rows = (await this.list()).filter((s) => s.runnable);
    if (rows.length === 0) return [];
    const systemId = await this.systemPersonaId();
    const personaIds = new Set((await this.personaStore.getAll()).map((p) => p.id));
    return rows.map((s) => s.toSkillDTO(s.personaId && personaIds.has(s.personaId) ? s.personaId : (systemId ?? '')));
  }

  /** What `@skill:<commandName>` runs on this ticket, or null (resolved silently). */
  async resolveForTicket(commandName: string, ticketId: string): Promise<ClaudeCodeSkillEntity | null> {
    if (!isReservedCommandName(commandName)) return null;
    const ticket = await this.ticketStore.getTicketById(ticketId);
    const repos = (ticket?.links ?? []).filter((l) => l.type === 'repository').map((l) => l.ref);
    return resolveClaudeCodeSkill(await this.list(), commandName, repos);
  }
}
