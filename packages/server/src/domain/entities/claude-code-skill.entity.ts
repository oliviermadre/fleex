import type {
  ClaudeCodeSkill,
  ClaudeCodeSkillOrigin,
  ClaudeCodeSkillStatus,
  Skill,
} from '@fleex/shared';

/**
 * Read-only mirror of a Claude Code SKILL.md found on one machine (`hostId`).
 * The body is never stored: Claude Code itself loads the skill at run time
 * through its native `Skill` tool. Only what the UI needs to list it is cached.
 */
export class ClaudeCodeSkillEntity {
  constructor(
    public readonly id: string,
    public readonly hostId: string,
    public readonly origin: ClaudeCodeSkillOrigin,
    public readonly nativeName: string,
    public commandName: string,
    public name: string,
    public description: string,
    public allowedTools: string[] | null,
    public plugin: string | null,
    /** `org/name` for `project` skills, null otherwise. */
    public readonly repo: string | null,
    public sourcePath: string,
    public realPath: string | null,
    public contentHash: string,
    public activatedHash: string | null,
    public enabled: boolean,
    /** Persona override. null = the system persona "Claude Code". */
    public personaId: string | null,
    public status: ClaudeCodeSkillStatus,
    public parseError: string | null,
    public lastSeenAt: Date,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  /** Only a skill whose SKILL.md is there, parses, and owns its name can run. */
  get activatable(): boolean {
    return this.status === 'present';
  }

  get modifiedSinceActivation(): boolean {
    return this.enabled && this.activatedHash !== null && this.activatedHash !== this.contentHash;
  }

  /** Runnable from a button or a mention. */
  get runnable(): boolean {
    return this.enabled && this.activatable;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    // Activating is the moment a human vouched for this exact content.
    if (enabled) this.activatedHash = this.contentHash;
    this.updatedAt = new Date();
  }

  revalidate(): void {
    if (this.enabled) this.activatedHash = this.contentHash;
    this.updatedAt = new Date();
  }

  setPersona(personaId: string | null): void {
    this.personaId = personaId;
    this.updatedAt = new Date();
  }

  toDTO(): ClaudeCodeSkill {
    return {
      id: this.id,
      hostId: this.hostId,
      origin: this.origin,
      nativeName: this.nativeName,
      commandName: this.commandName,
      name: this.name,
      description: this.description,
      allowedTools: this.allowedTools,
      plugin: this.plugin,
      repo: this.repo,
      sourcePath: this.sourcePath,
      realPath: this.realPath,
      enabled: this.enabled,
      personaId: this.personaId,
      status: this.status,
      parseError: this.parseError,
      modifiedSinceActivation: this.modifiedSinceActivation,
      lastSeenAt: this.lastSeenAt.toISOString(),
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Same shape as a native skill so the SmartSessionButton, the mention
   * autocomplete and `fleex skill list` pick it up unchanged.
   * `personaId` is the effective persona (override or system persona).
   */
  toSkillDTO(effectivePersonaId: string): Skill {
    return {
      id: this.id,
      commandName: this.commandName,
      name: this.name,
      displayName: this.name || this.nativeName,
      markdownContent: '',
      enabled: this.runnable,
      personaId: effectivePersonaId,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      source: 'claude_code',
      ccOrigin: this.origin,
      nativeName: this.nativeName,
      repo: this.repo,
      description: this.description,
      sourcePath: this.sourcePath,
    };
  }
}
