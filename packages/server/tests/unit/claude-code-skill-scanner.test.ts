import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeSkillScanner, type ScannableRepository } from '../../src/application/services/claude-code-skill-scanner.js';
import type { ExecFn, HostFs } from '../../src/infrastructure/host/types.js';

/** HostFs on the real disk, with the gateway's semantics (Dirent types, no link following). */
const localFs: HostFs = {
  readFile: (p) => fsp.readFile(p, 'utf-8'),
  writeFile: (p, c) => fsp.writeFile(p, c),
  appendFile: (p, c) => fsp.appendFile(p, c),
  readdir: async (p) => (await fsp.readdir(p, { withFileTypes: true }))
    .map((d) => ({ name: d.name, isFile: d.isFile(), isDirectory: d.isDirectory() })),
  stat: async (p) => { try { const s = await fsp.stat(p); return { size: s.size, mtimeMs: s.mtimeMs }; } catch { return null; } },
  exists: async (p) => { try { await fsp.access(p); return true; } catch { return false; } },
  mkdir: async (p) => { await fsp.mkdir(p, { recursive: true }); },
  rm: (p, o) => fsp.rm(p, { recursive: o?.recursive }),
  readTail: async () => '',
  realpath: async (p) => { try { return await fsp.realpath(p); } catch { return null; } },
};

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const md = (name: string | null, description = `about ${name}`) =>
  `---\n${name ? `name: ${name}\n` : ''}description: ${description}\n---\n\n# ${name}\n`;

function write(path: string, content: string) {
  fs.mkdirSync(join(path, '..'), { recursive: true });
  fs.writeFileSync(path, content);
}

let home: string;
beforeEach(() => { home = fs.mkdtempSync(join(tmpdir(), 'cc-scan-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

function scanner(opts: { exec?: ExecFn; repos?: ScannableRepository[] } = {}) {
  const exec: ExecFn = opts.exec ?? (async () => { throw new Error('no git'); });
  return new ClaudeCodeSkillScanner(localFs, exec, home, async () => opts.repos ?? [], logger);
}

describe('ClaudeCodeSkillScanner — user & synced skills', () => {
  it('follows symlinked skills, ignores dot dirs, and reports one file reached twice only once', async () => {
    const skills = join(home, '.claude/skills');
    write(join(skills, 'fleex-push/SKILL.md'), md('fleex-push'));
    write(join(home, '.agents/skills/find-skills/SKILL.md'), md('find-skills'));
    fs.symlinkSync(join(home, '.agents/skills/find-skills'), join(skills, 'find-skills'));
    fs.symlinkSync(join(home, '.agents/skills/find-skills'), join(skills, 'find-skills-alias'));
    write(join(skills, '.trash/old/SKILL.md'), md('old'));
    write(join(skills, 'no-skill-md/README.md'), 'x');

    const found = await scanner().scan();
    expect(found.map((s) => s.nativeName).sort()).toEqual(['find-skills', 'fleex-push']);
    const linked = found.find((s) => s.nativeName === 'find-skills')!;
    expect(linked.realPath).toBe(fs.realpathSync(join(home, '.agents/skills/find-skills/SKILL.md')));
  });

  it('falls back to the folder name when the frontmatter has no name', async () => {
    write(join(home, '.claude/skills/my-tool/SKILL.md'), md(null, 'does things'));
    const [skill] = await scanner().scan();
    expect(skill).toMatchObject({ origin: 'user', nativeName: 'my-tool', description: 'does things', parseError: null });
  });

  it('lists a broken SKILL.md as an error instead of failing the scan', async () => {
    write(join(home, '.claude/skills/broken/SKILL.md'), '---\nname: broken\n---\n');
    write(join(home, '.claude/skills/ok/SKILL.md'), md('ok'));
    const found = await scanner().scan();
    expect(found.find((s) => s.nativeName === 'broken')!.parseError).toContain('description');
    expect(found.find((s) => s.nativeName === 'ok')!.parseError).toBeNull();
  });

  it('exposes claude.ai synced skills under the anthropic-skills namespace, not as user skills', async () => {
    write(join(home, '.claude/skills/synced/abc_123/pdf/SKILL.md'), md('pdf'));
    write(join(home, '.claude/skills/synced/abc_123/manifest.json'), '{}');
    const found = await scanner().scan();
    expect(found).toEqual([expect.objectContaining({ origin: 'synced', nativeName: 'anthropic-skills:pdf' })]);
  });
});

describe('ClaudeCodeSkillScanner — plugins', () => {
  it('only reads skills of enabled, user-scoped installs — never stale copies left in the cache', async () => {
    const cache = join(home, '.claude/plugins/cache/official/superpowers');
    write(join(cache, '6.4.1/skills/brainstorming/SKILL.md'), md('brainstorming'));
    write(join(cache, '6.3.0/skills/brainstorming/SKILL.md'), md('brainstorming', 'stale'));
    write(join(cache, 'temp_git_123/skills/brainstorming/SKILL.md'), md('brainstorming', 'temp'));
    write(join(home, '.claude/plugins/cache/x/disabled/1.0/skills/nope/SKILL.md'), md('nope'));
    write(join(home, '.claude/plugins/cache/x/projonly/1.0/skills/proj/SKILL.md'), md('proj'));
    write(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: {
        'superpowers@official': [
          { scope: 'project', projectPath: '/p', installPath: join(cache, '6.3.0') },
          { scope: 'user', installPath: join(cache, '6.4.1') },
        ],
        'disabled@x': [{ scope: 'user', installPath: join(home, '.claude/plugins/cache/x/disabled/1.0') }],
        'projonly@x': [{ scope: 'project', projectPath: '/p', installPath: join(home, '.claude/plugins/cache/x/projonly/1.0') }],
      },
    }));
    write(join(home, '.claude/settings.json'), JSON.stringify({
      enabledPlugins: { 'superpowers@official': true, 'disabled@x': false, 'projonly@x': true },
    }));

    const found = await scanner().scan();
    expect(found).toEqual([expect.objectContaining({
      origin: 'plugin', nativeName: 'superpowers:brainstorming', plugin: 'superpowers@official', description: 'about brainstorming',
    })]);
  });
});

describe('ClaudeCodeSkillScanner — single-skill plugins', () => {
  it('reads a SKILL.md shipped at the plugin root (e.g. visual-explainer:visual-explainer)', async () => {
    const install = join(home, '.claude/plugins/cache/m/visual-explainer/0.5.1');
    write(join(install, 'SKILL.md'), md('visual-explainer'));
    write(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
      plugins: { 'visual-explainer@m': [{ scope: 'user', installPath: install }] },
    }));
    write(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'visual-explainer@m': true } }));
    const found = await scanner().scan();
    expect(found).toEqual([expect.objectContaining({ origin: 'plugin', nativeName: 'visual-explainer:visual-explainer' })]);
  });
});

describe('ClaudeCodeSkillScanner — project skills', () => {
  it('reads .claude/skills from bare clones with git, on the default branch', async () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === 'ls-tree') {
        return { stdout: '.claude/skills/deploy/SKILL.md\n.claude/skills/deploy/scripts/run.sh\n.claude/skills/.hidden/SKILL.md\n', stderr: '' };
      }
      return { stdout: md('deploy'), stderr: '' };
    };
    const repos = [
      { org: 'evaneos', name: 'fleex', barePath: '/b/fleex.git', defaultBranch: 'main', isCloned: true },
      { org: 'evaneos', name: 'not-cloned', barePath: '/b/x.git', defaultBranch: 'main', isCloned: false },
    ];
    const found = await scanner({ exec, repos }).scan();
    expect(found).toEqual([expect.objectContaining({
      origin: 'project', nativeName: 'deploy', repo: 'evaneos/fleex', sourcePath: '.claude/skills/deploy/SKILL.md',
    })]);
    expect(calls).toContainEqual(['show', 'origin/main:.claude/skills/deploy/SKILL.md']);
    expect(calls.every((a) => !a.join(' ').includes('not-cloned'))).toBe(true);
  });

  it('survives a repo git cannot read', async () => {
    const repos = [{ org: 'o', name: 'empty', barePath: '/b', defaultBranch: 'main', isCloned: true }];
    write(join(home, '.claude/skills/ok/SKILL.md'), md('ok'));
    const found = await scanner({ repos }).scan();
    expect(found.map((s) => s.nativeName)).toEqual(['ok']);
  });
});
