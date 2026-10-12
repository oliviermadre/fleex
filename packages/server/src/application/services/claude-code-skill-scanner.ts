import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ClaudeCodeSkillOrigin } from '@fleex/shared';
import type { ExecFn, HostFs } from '../../infrastructure/host/types.js';
import type { LoggerPort } from '../ports/logger.port.js';
import { parseSkillFrontmatter, type DiscoveredSkill } from '../../domain/services/claude-code-skills.js';

export interface ScannableRepository {
  org: string;
  name: string;
  barePath: string;
  defaultBranch: string;
  isCloned: boolean;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Finds Claude Code skills on the host. Never throws: an unreadable source is
 * logged and skipped, a broken SKILL.md becomes an `invalid` entry.
 *
 * Sources (see spec D4):
 * - user:    ~/.claude/skills/<dir>/SKILL.md (symlinks followed, dot dirs and `synced` skipped)
 * - synced:  ~/.claude/skills/synced/<id>/<dir>/SKILL.md → `anthropic-skills:<name>`
 * - plugin:  installed_plugins.json, user scope, enabled in settings.json → `<plugin>:<name>`
 *            (never a blind walk of ~/.claude/plugins/cache: it holds stale copies)
 * - project: `.claude/skills/<dir>/SKILL.md` read from each bare clone with git
 *
 * One file reached through several paths (symlinks) is reported once, under
 * the most specific origin.
 */
export class ClaudeCodeSkillScanner {
  constructor(
    private readonly hostFs: HostFs,
    private readonly execFn: ExecFn,
    private readonly homedir: string,
    private readonly listRepositories: () => Promise<ScannableRepository[]>,
    private readonly logger: LoggerPort,
  ) {}

  async scan(): Promise<DiscoveredSkill[]> {
    const claudeDir = join(this.homedir, '.claude');
    const groups = await Promise.all([
      this.safe('project', () => this.scanProjects()),
      this.safe('user', () => this.scanSkillDirs(join(claudeDir, 'skills'), 'user', (n) => n, ['synced'])),
      this.safe('plugin', () => this.scanPlugins(claudeDir)),
      this.safe('synced', () => this.scanSynced(join(claudeDir, 'skills', 'synced'))),
    ]);

    const seenRealPaths = new Set<string>();
    const result: DiscoveredSkill[] = [];
    for (const skill of groups.flat()) {
      if (skill.realPath) {
        if (seenRealPaths.has(skill.realPath)) continue;
        seenRealPaths.add(skill.realPath);
      }
      result.push(skill);
    }
    return result;
  }

  /** Current SKILL.md of a mirrored skill, read live (never stored). */
  async readContent(skill: { repo: string | null; sourcePath: string }): Promise<string> {
    if (!skill.repo) return this.hostFs.readFile(skill.sourcePath);
    const repo = (await this.listRepositories())
      .find((r) => `${r.org}/${r.name}`.toLowerCase() === skill.repo!.toLowerCase());
    if (!repo?.isCloned) throw new Error(`Repository not cloned on this host: ${skill.repo}`);
    const ref = repo.defaultBranch ? `origin/${repo.defaultBranch}` : 'HEAD';
    const { stdout } = await this.execFn('git', ['show', `${ref}:${skill.sourcePath}`], { cwd: repo.barePath });
    return stdout;
  }

  private async safe(source: string, fn: () => Promise<DiscoveredSkill[]>): Promise<DiscoveredSkill[]> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn('Claude Code skill source unreadable — skipped', {
        source,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /** `<root>/<dir>/SKILL.md` for every non-dot entry (directories or symlinks). */
  private async scanSkillDirs(
    root: string,
    origin: ClaudeCodeSkillOrigin,
    toNativeName: (name: string) => string,
    skip: string[] = [],
    plugin: string | null = null,
  ): Promise<DiscoveredSkill[]> {
    if (!(await this.hostFs.exists(root))) return [];
    const entries = await this.hostFs.readdir(root);
    const found: DiscoveredSkill[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || skip.includes(entry.name) || entry.isFile) continue;
      const skillMd = join(root, entry.name, 'SKILL.md');
      if (!(await this.hostFs.exists(skillMd))) continue;
      try {
        const content = await this.hostFs.readFile(skillMd);
        const realPath = await this.hostFs.realpath(skillMd).catch(() => null);
        found.push(this.toDiscovered({ origin, dirName: entry.name, content, sourcePath: skillMd, realPath, plugin, repo: null, toNativeName }));
      } catch (err) {
        this.logger.warn('Cannot read SKILL.md', { path: skillMd, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return found;
  }

  private async scanSynced(root: string): Promise<DiscoveredSkill[]> {
    if (!(await this.hostFs.exists(root))) return [];
    const bundles = await this.hostFs.readdir(root);
    const found: DiscoveredSkill[] = [];
    for (const bundle of bundles) {
      if (bundle.name.startsWith('.') || bundle.isFile) continue;
      found.push(...await this.scanSkillDirs(join(root, bundle.name), 'synced', (n) => `anthropic-skills:${n}`));
    }
    return found;
  }

  private async scanPlugins(claudeDir: string): Promise<DiscoveredSkill[]> {
    const manifestPath = join(claudeDir, 'plugins', 'installed_plugins.json');
    if (!(await this.hostFs.exists(manifestPath))) return [];
    const manifest = JSON.parse(await this.hostFs.readFile(manifestPath)) as {
      plugins?: Record<string, { scope?: string; installPath?: string }[]>;
    };
    const enabled = await this.readEnabledPlugins(claudeDir);

    const found: DiscoveredSkill[] = [];
    for (const [key, installs] of Object.entries(manifest.plugins ?? {})) {
      if (enabled[key] !== true) continue;
      // Project-scoped installs are out of v1: their projectPath does not map to a Fleex repo.
      const install = (installs ?? []).find((i) => i.scope === 'user' && i.installPath);
      if (!install) continue;
      const pluginName = key.split('@')[0]!;
      const toNativeName = (n: string) => `${pluginName}:${n}`;
      // Single-skill plugins ship their SKILL.md at the plugin root.
      const rootSkill = join(install.installPath!, 'SKILL.md');
      if (await this.hostFs.exists(rootSkill)) {
        const content = await this.hostFs.readFile(rootSkill);
        const realPath = await this.hostFs.realpath(rootSkill).catch(() => null);
        found.push(this.toDiscovered({
          origin: 'plugin', dirName: pluginName, content, sourcePath: rootSkill, realPath, plugin: key, repo: null, toNativeName,
        }));
      }
      found.push(...await this.scanSkillDirs(join(install.installPath!, 'skills'), 'plugin', toNativeName, [], key));
    }
    return found;
  }

  private async readEnabledPlugins(claudeDir: string): Promise<Record<string, unknown>> {
    const settingsPath = join(claudeDir, 'settings.json');
    try {
      const settings = JSON.parse(await this.hostFs.readFile(settingsPath)) as { enabledPlugins?: Record<string, unknown> };
      return settings.enabledPlugins ?? {};
    } catch {
      return {};
    }
  }

  private async scanProjects(): Promise<DiscoveredSkill[]> {
    const repos = (await this.listRepositories()).filter((r) => r.isCloned);
    const found: DiscoveredSkill[] = [];
    for (const repo of repos) {
      const repoKey = `${repo.org}/${repo.name}`;
      try {
        const ref = repo.defaultBranch ? `origin/${repo.defaultBranch}` : 'HEAD';
        const { stdout } = await this.execFn(
          'git', ['ls-tree', '-r', '--name-only', ref, '--', '.claude/skills/'], { cwd: repo.barePath },
        );
        const paths = stdout.split('\n').map((l) => l.trim())
          .filter((p) => /^\.claude\/skills\/[^/.][^/]*\/SKILL\.md$/.test(p));
        for (const path of paths) {
          const { stdout: content } = await this.execFn('git', ['show', `${ref}:${path}`], { cwd: repo.barePath });
          const dirName = path.split('/')[2]!;
          found.push(this.toDiscovered({
            origin: 'project', dirName, content, sourcePath: path, realPath: null, plugin: null, repo: repoKey,
            toNativeName: (n) => n,
          }));
        }
      } catch (err) {
        // Empty repos, missing branch… the repo simply contributes no skill.
        this.logger.debug('No project skills read from repo', {
          repo: repoKey, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return found;
  }

  private toDiscovered(p: {
    origin: ClaudeCodeSkillOrigin;
    dirName: string;
    content: string;
    sourcePath: string;
    realPath: string | null;
    plugin: string | null;
    repo: string | null;
    toNativeName: (name: string) => string;
  }): DiscoveredSkill {
    const parsed = parseSkillFrontmatter(p.content);
    const name = parsed.ok && parsed.value.name ? parsed.value.name : p.dirName;
    return {
      origin: p.origin,
      nativeName: p.toNativeName(name),
      name,
      description: parsed.ok ? parsed.value.description : '',
      allowedTools: parsed.ok ? parsed.value.allowedTools : null,
      plugin: p.plugin,
      repo: p.repo,
      sourcePath: p.sourcePath,
      realPath: p.realPath,
      contentHash: sha256(p.content),
      parseError: parsed.ok ? null : parsed.error,
    };
  }
}
