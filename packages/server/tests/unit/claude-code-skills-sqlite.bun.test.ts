import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteClaudeCodeSkillStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-claude-code-skill-store.adapter.js';
import { SqlitePersonaStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-persona-store.adapter.js';
import { SqliteSkillStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-skill-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { ClaudeCodeSkillsUseCase } from '../../src/application/use-cases/claude-code-skills.js';
import { DeletePersonaUseCase } from '../../src/application/use-cases/delete-persona.js';
import { UpdatePersonaUseCase } from '../../src/application/use-cases/update-persona.js';
import { CreatePersonaUseCase } from '../../src/application/use-cases/create-persona.js';
import { CreateSkillUseCase } from '../../src/application/use-cases/create-skill.js';
import type { ClaudeCodeSkillScanner } from '../../src/application/services/claude-code-skill-scanner.js';
import type { DiscoveredSkill } from '../../src/domain/services/claude-code-skills.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
let conn: SqliteConnection;
let ccStore: SqliteClaudeCodeSkillStoreAdapter;
let personaStore: SqlitePersonaStoreAdapter;
let skillStore: SqliteSkillStoreAdapter;
let onDisk: DiscoveredSkill[];

const found = (nativeName: string, over: Partial<DiscoveredSkill> = {}): DiscoveredSkill => ({
  origin: 'user', nativeName, name: nativeName, description: `about ${nativeName}`, allowedTools: ['Bash'],
  plugin: null, repo: null, sourcePath: `/h/${nativeName}/SKILL.md`, realPath: null, contentHash: 'h1', parseError: null,
  ...over,
});

const tickets = {
  getTicketById: async (id: string) => ({ links: id === 'linked' ? [{ type: 'repository', ref: 'evaneos/fleex' }] : [] }),
} as unknown as TicketStorePort;

function useCase(hostId: string) {
  const scanner = { scan: async () => onDisk, readContent: async () => 'x' } as unknown as ClaudeCodeSkillScanner;
  return new ClaudeCodeSkillsUseCase(ccStore, scanner, skillStore, personaStore, tickets, hostId, silent);
}

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  ccStore = new SqliteClaudeCodeSkillStoreAdapter(conn);
  personaStore = new SqlitePersonaStoreAdapter(conn);
  skillStore = new SqliteSkillStoreAdapter(conn);
  onDisk = [found('fleex-push'), found('deploy'), found('deploy', { origin: 'project', repo: 'evaneos/fleex', sourcePath: '.claude/skills/deploy/SKILL.md' })];
});
afterEach(() => conn.close());

describe('migration 036', () => {
  it('seeds the "Claude Code" system persona exactly once', async () => {
    const persona = await personaStore.getByName('claude-code');
    expect(persona).toMatchObject({ displayName: 'Claude Code' });
    await runPendingMigrations('sqlite', conn, silent as never);
    expect((await personaStore.getAll()).filter((p) => p.name === 'claude-code')).toHaveLength(1);
  });
});

describe('ClaudeCodeSkillsUseCase on SQLite', () => {
  it('round-trips scanned rows, all disabled, and only lists them once enabled', async () => {
    const cc = useCase('mbp');
    expect(await cc.scan()).toMatchObject({ added: 3, total: 3 });
    const rows = await cc.list();
    expect(rows.every((r) => !r.enabled)).toBe(true);
    expect(rows.find((r) => r.origin === 'user' && r.nativeName === 'fleex-push')!.allowedTools).toEqual(['Bash']);
    expect(await cc.listAsSkills()).toEqual([]);

    await cc.setEnabled(rows.map((r) => r.id), true);
    const skills = await cc.listAsSkills();
    const systemId = (await personaStore.getByName('claude-code'))!.id;
    expect(skills).toHaveLength(3);
    expect(skills.every((s) => s.source === 'claude_code' && s.personaId === systemId)).toBe(true);
  });

  it('never shows nor resolves another machine\'s skills on a shared database', async () => {
    await useCase('mbp').scan();
    const other = useCase('ci-runner');
    expect(await other.list()).toEqual([]);
    const mine = await useCase('mbp').list();
    await expect(other.get(mine[0]!.id)).rejects.toMatchObject({ code: 'CLAUDE_CODE_SKILL_NOT_FOUND' });
  });

  it('resolves @skill:cc-deploy to the project skill on a ticket linked to its repo, the user one elsewhere', async () => {
    const cc = useCase('mbp');
    await cc.scan();
    await cc.setEnabled((await cc.list()).map((r) => r.id), true);
    expect((await cc.resolveForTicket('cc-deploy', 'linked'))!.origin).toBe('project');
    expect((await cc.resolveForTicket('cc-deploy', 'other'))!.origin).toBe('user');
    expect(await cc.resolveForTicket('deploy', 'other')).toBeNull();
  });

  it('refuses to enable a skill that is not present', async () => {
    onDisk = [found('broken', { parseError: 'frontmatter: missing' })];
    const cc = useCase('mbp');
    await cc.scan();
    const [row] = await cc.list();
    await expect(cc.update(row!.id, { enabled: true })).rejects.toMatchObject({ code: 'CLAUDE_CODE_SKILL_NOT_ACTIVATABLE' });
  });

  it('falls back to the system persona when the override persona is deleted', async () => {
    const cc = useCase('mbp');
    await cc.scan();
    const builder = await new CreatePersonaUseCase(personaStore, silent).execute({ name: 'builder', displayName: 'Builder' });
    const [row] = await cc.list();
    await cc.update(row!.id, { personaId: builder.id });
    expect((await cc.get(row!.id)).personaId).toBe(builder.id);

    await new DeletePersonaUseCase(personaStore, silent, ccStore).execute(builder.id);
    const after = await cc.get(row!.id);
    expect(after.personaId).toBeNull();
    expect(await cc.effectivePersonaId(after)).toBe((await personaStore.getByName('claude-code'))!.id);
  });
});

describe('guards', () => {
  it('the system persona can be neither deleted nor renamed', async () => {
    const system = (await personaStore.getByName('claude-code'))!;
    await expect(new DeletePersonaUseCase(personaStore, silent, ccStore).execute(system.id))
      .rejects.toMatchObject({ code: 'SYSTEM_PERSONA_PROTECTED' });
    await expect(new UpdatePersonaUseCase(personaStore, silent).execute(system.id, { name: 'other' }))
      .rejects.toMatchObject({ code: 'SYSTEM_PERSONA_PROTECTED' });
    // Its model and soul stay editable.
    await new UpdatePersonaUseCase(personaStore, silent).execute(system.id, { model: 'claude-opus-5' });
  });

  it('reserves the cc- prefix: a native skill cannot squat a Claude Code mention', async () => {
    const system = (await personaStore.getByName('claude-code'))!;
    await expect(new CreateSkillUseCase(skillStore, personaStore, silent).execute({
      commandName: 'cc-bar', name: 'bar', displayName: 'Bar', personaId: system.id,
    })).rejects.toMatchObject({ code: 'RESERVED_SKILL_COMMAND_NAME' });
  });
});
