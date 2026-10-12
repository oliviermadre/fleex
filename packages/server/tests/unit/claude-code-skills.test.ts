import { describe, it, expect } from 'vitest';
import { ClaudeCodeSkillEntity } from '../../src/domain/entities/claude-code-skill.entity.js';
import {
  parseSkillFrontmatter,
  reconcileScan,
  resolveClaudeCodeSkill,
  toClaudeCodeCommandName,
  type DiscoveredSkill,
} from '../../src/domain/services/claude-code-skills.js';

const T0 = new Date('2026-10-01T00:00:00Z');
const T1 = new Date('2026-10-02T00:00:00Z');
let n = 0;
const newId = () => `id-${++n}`;

function found(over: Partial<DiscoveredSkill> & { nativeName: string }): DiscoveredSkill {
  return {
    origin: 'user', name: over.nativeName, description: 'd', allowedTools: null, plugin: null, repo: null,
    sourcePath: `/h/.claude/skills/${over.nativeName}/SKILL.md`, realPath: null, contentHash: 'h1', parseError: null,
    ...over,
  };
}

function scan(existing: ClaudeCodeSkillEntity[], discovered: DiscoveredSkill[], natives: string[] = [], now = T0) {
  return reconcileScan({ hostId: 'mbp', existing, discovered, nativeCommandNames: new Set(natives), now, newId });
}

describe('toClaudeCodeCommandName', () => {
  // Mentions only parse [a-zA-Z0-9_-]+: anything else would silently never trigger.
  it.each([
    ['fleex-push', 'cc-fleex-push'],
    ['superpowers:brainstorming', 'cc-superpowers--brainstorming'],
    ['anthropic-skills:pdf', 'cc-anthropic-skills--pdf'],
    ['a/b', 'cc-a--b'],
    ['Weekly Report!', 'cc-weekly-report-'],
  ])('%s → %s', (native, expected) => {
    expect(toClaudeCodeCommandName(native)).toBe(expected);
    expect(expected).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe('parseSkillFrontmatter', () => {
  it('reads name, description and allowed-tools in their usual forms', () => {
    const r = parseSkillFrontmatter('---\nname: deploy\ndescription: "Ship it: now"\nallowed-tools: Bash, Edit\n---\n# body');
    expect(r).toEqual({ ok: true, value: { name: 'deploy', description: 'Ship it: now', allowedTools: ['Bash', 'Edit'] } });
  });

  it('supports folded descriptions and block lists', () => {
    const r = parseSkillFrontmatter('---\ndescription: >\n  line one\n  line two\nallowed-tools:\n  - Read\n  - "Bash(git *)"\n---\n');
    expect(r).toEqual({ ok: true, value: { name: null, description: 'line one line two', allowedTools: ['Read', 'Bash(git *)'] } });
  });

  it('reports instead of throwing on broken files, so one bad skill never aborts a scan', () => {
    expect(parseSkillFrontmatter('# no frontmatter')).toMatchObject({ ok: false });
    expect(parseSkillFrontmatter('---\nname: x\n')).toMatchObject({ ok: false, error: expect.stringContaining('closing') });
    expect(parseSkillFrontmatter('---\nname: x\n---\n')).toMatchObject({ ok: false, error: expect.stringContaining('description') });
  });
});

describe('reconcileScan', () => {
  it('imports new skills disabled: nothing is runnable until a human opts in', () => {
    const { rows, report } = scan([], [found({ nativeName: 'foo' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ commandName: 'cc-foo', enabled: false, status: 'present', personaId: null });
    expect(report).toMatchObject({ added: 1, total: 1 });
  });

  it('keeps activation and persona override across scans; a vanished skill becomes missing, then comes back intact', () => {
    const first = scan([], [found({ nativeName: 'foo' })]).rows;
    first[0]!.setEnabled(true);
    first[0]!.setPersona('p-builder');

    const gone = scan(first, [], [], T1);
    expect(gone.rows[0]).toMatchObject({ status: 'missing', enabled: true, personaId: 'p-builder' });
    expect(gone.rows[0]!.runnable).toBe(false);
    expect(gone.report.missing).toBe(1);

    const back = scan(gone.rows, [found({ nativeName: 'foo' })], [], T1);
    expect(back.rows[0]).toMatchObject({ id: first[0]!.id, status: 'present', enabled: true, personaId: 'p-builder' });
    expect(back.report.back).toBe(1);
  });

  it('flags an enabled skill whose SKILL.md changed, without disabling it', () => {
    const rows = scan([], [found({ nativeName: 'foo', contentHash: 'h1' })]).rows;
    rows[0]!.setEnabled(true);
    const next = scan(rows, [found({ nativeName: 'foo', contentHash: 'h2' })]);
    expect(next.report.changed).toBe(1);
    expect(next.rows[0]!.enabled).toBe(true);
    expect(next.rows[0]!.modifiedSinceActivation).toBe(true);
    next.rows[0]!.revalidate();
    expect(next.rows[0]!.modifiedSinceActivation).toBe(false);
  });

  it('marks unparsable skills invalid (listed, not activatable)', () => {
    const { rows, report } = scan([], [found({ nativeName: 'broken', parseError: 'frontmatter: x' })]);
    expect(rows[0]).toMatchObject({ status: 'invalid', parseError: 'frontmatter: x' });
    expect(rows[0]!.activatable).toBe(false);
    expect(report.invalid).toBe(1);
  });

  it('lets a legacy native `cc-*` skill keep its name: the Claude Code skill is put in conflict', () => {
    const { rows } = scan([], [found({ nativeName: 'review' })], ['cc-review']);
    expect(rows[0]!.status).toBe('conflict');
    expect(rows[0]!.activatable).toBe(false);
  });

  it('suffixes names that collide after normalization, and keeps them stable across scans', () => {
    const a = found({ nativeName: 'a:b' });
    const b = found({ nativeName: 'a--b', sourcePath: '/x' });
    const first = scan([], [a, b]).rows;
    const names = Object.fromEntries(first.map((r) => [r.nativeName, r.commandName]));
    expect(new Set(Object.values(names))).toEqual(new Set(['cc-a--b', 'cc-a--b-2']));

    // A newcomer sorting first must not steal an existing name.
    const again = scan(first, [found({ nativeName: 'a/b' }), a, b]).rows;
    for (const r of again.filter((x) => x.nativeName !== 'a/b')) expect(r.commandName).toBe(names[r.nativeName]);
    expect(again.find((r) => r.nativeName === 'a/b')!.commandName).toBe('cc-a--b-3');
  });

  it('gives a user and a project skill of the same name the same command name', () => {
    const { rows } = scan([], [
      found({ nativeName: 'deploy' }),
      found({ nativeName: 'deploy', origin: 'project', repo: 'evaneos/fleex', sourcePath: '.claude/skills/deploy/SKILL.md' }),
    ]);
    expect(rows.map((r) => r.commandName)).toEqual(['cc-deploy', 'cc-deploy']);
  });
});

describe('resolveClaudeCodeSkill', () => {
  const rows = scan([], [
    found({ nativeName: 'deploy' }),
    found({ nativeName: 'deploy', origin: 'project', repo: 'evaneos/fleex', sourcePath: '.claude/skills/deploy/SKILL.md' }),
    found({ nativeName: 'db-migrate', origin: 'project', repo: 'evaneos/fleex', sourcePath: '.claude/skills/db-migrate/SKILL.md' }),
    found({ nativeName: 'off' }),
  ]).rows;
  rows.filter((r) => r.nativeName !== 'off').forEach((r) => r.setEnabled(true));

  it('runs the project version inside its repo and the user version elsewhere (Claude Code rule)', () => {
    expect(resolveClaudeCodeSkill(rows, 'cc-deploy', ['evaneos/fleex'])!.origin).toBe('project');
    expect(resolveClaudeCodeSkill(rows, 'cc-deploy', ['Evaneos/Fleex'])!.origin).toBe('project');
    expect(resolveClaudeCodeSkill(rows, 'cc-deploy', [])!.origin).toBe('user');
  });

  it('never resolves a project skill on a ticket that is not linked to its repo', () => {
    expect(resolveClaudeCodeSkill(rows, 'cc-db-migrate', ['evaneos/other'])).toBeNull();
    expect(resolveClaudeCodeSkill(rows, 'cc-db-migrate', ['evaneos/fleex'])).not.toBeNull();
  });

  it('never resolves a disabled skill', () => {
    expect(resolveClaudeCodeSkill(rows, 'cc-off', [])).toBeNull();
  });
});
