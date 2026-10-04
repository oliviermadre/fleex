import { dirname, join } from 'node:path';
import type { LoggerPort } from '../ports/logger.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { GitPort } from '../ports/git.port.js';
import type { HostFs, ExecFn } from '../../infrastructure/host/types.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type {
  WorktreeSetupSnapshot,
  HookResult,
  OverlayFileStatus,
  OverlaySyncApplyItem,
  OverlaySyncApplyResponse,
  OverlaySyncFileNode,
  OverlaySyncFilePreview,
  OverlaySyncPreviewResponse,
  OverlaySyncRemoveResponse,
  OverlaySyncRepoScan,
} from '@fleex/shared';
import { buildFleexEnv, envArgv, interpolateHook } from '../../domain/services/worktree-env.js';
import {
  buildTree,
  classifyStatus,
  isDenylistedDir,
  isSafeRelPath,
  parseIgnoredEntries,
  type CollapsedDir,
} from './overlay-sync-helpers.js';

const DEFAULT_HOOK_TIMEOUT_SECONDS = 60;

/** Max content bytes returned in a preview (larger files are truncated). */
const PREVIEW_CAP_BYTES = 256 * 1024;
/** Never read a file larger than this into memory for preview. */
const PREVIEW_MAX_READ_BYTES = 2 * 1024 * 1024;
/** Above this size, status is decided by size alone (no content compare). */
const STATUS_READ_CAP_BYTES = 1024 * 1024;
/** Cap on files pulled out of a single expanded (non-denylisted) ignored dir. */
const MAX_EXPANDED_FILES = 500;
/** Cap on entries listed from an overlay's files dir. */
const MAX_OVERLAY_ENTRIES = 2000;

export class OverlayManager {
  constructor(
    private readonly hostFs: HostFs,
    private readonly resolver: RepoPathResolver,
    private readonly execFn: ExecFn,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
    private readonly git: GitPort,
  ) {}

  /**
   * Ensure overlay directory structure exists for a repo and the global overlay.
   */
  async ensureOverlayDirs(org: string, name: string): Promise<void> {
    const dirs = [
      this.resolver.overlayFilesDir(org, name),
      this.resolver.overlayHooksDir(org, name),
      this.resolver.globalOverlayFilesDir(),
      this.resolver.globalOverlayHooksDir(),
    ];
    for (const dir of dirs) {
      if (!(await this.hostFs.exists(dir))) {
        await this.hostFs.mkdir(dir);
      }
    }
  }

  /**
   * Copy overlay files into a worktree.
   * Applies global overlay first, then per-repo overlay (which overrides global).
   */
  async applyOverlay(org: string, name: string, worktreePath: string): Promise<void> {
    // Global overlay first
    await this.copyOverlayFiles(this.resolver.globalOverlayFilesDir(), worktreePath);
    // Per-repo overlay overrides global
    await this.copyOverlayFiles(this.resolver.overlayFilesDir(org, name), worktreePath);
  }

  private async copyOverlayFiles(filesDir: string, worktreePath: string): Promise<void> {
    const exists = await this.hostFs.exists(filesDir);
    if (!exists) return;

    try {
      await this.execFn('cp', ['-r', `${filesDir}/.`, worktreePath]);
      this.logger.info('Applied overlay files to worktree', { source: filesDir, worktreePath });
    } catch (err) {
      this.logger.warn('Failed to apply overlay files', {
        source: filesDir, worktreePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Setup state of a worktree, as it runs (wired to the worktree actions, which broadcast it). */
  onSetupState: (snapshot: WorktreeSetupSnapshot) => void = () => {};
  /** Extra hook environment for a worktree (its reserved port range, when port reservation is on). */
  extraHookEnv: (worktreePath: string) => Promise<Record<string, string>> = async () => ({});

  /**
   * Run the Setup hooks of a new worktree (formerly "post-checkout"), in order:
   * global file hooks, then the repo's file hooks, then the inline Setup script.
   * Fire-and-forget — never blocking the worktree or the agents — but its
   * progress is reported (`onSetupState`) for the worktree menu.
   *
   * The inline script comes from the config layers (PRD §9): the personal
   * `worktreeConfigs[repo].hooks.setup`, else `hooks.setup` of the worktree's
   * own `.fleex/worktree.json`, else the legacy `postCheckoutHook`. Every hook
   * gets the `FLEEX_*` environment; `{{…}}` substitutions keep working.
   *
   * Returns true when an inline script is known to run. A Setup that only lives
   * in `.fleex/worktree.json` is read asynchronously, so it still runs but this
   * returns false.
   */
  firePostCheckoutHooks(
    org: string,
    name: string,
    worktreePath: string,
    branch: string,
  ): boolean {
    const repoKey = `${org}/${name}`;
    const appConfig = this.config.get();
    const repoConfig = appConfig.repoConfigs?.[repoKey];
    const personal = appConfig.worktreeConfigs?.[repoKey]?.hooks;
    const legacy = repoConfig?.postCheckoutHook;
    const timeoutMs = (personal?.timeoutSec ?? repoConfig?.hookTimeoutSeconds ?? DEFAULT_HOOK_TIMEOUT_SECONDS) * 1000;
    const fileTimeoutMs = (repoConfig?.hookTimeoutSeconds ?? DEFAULT_HOOK_TIMEOUT_SECONDS) * 1000;

    void (async () => {
      const env = await this.hookEnv(org, name, worktreePath, branch);
      const files = [
        ...(await this.listHookScripts(this.resolver.globalOverlayHooksDir())),
        ...(await this.listHookScripts(this.resolver.overlayHooksDir(org, name))),
      ];
      // Personal layer set (even to '' = explicitly none) wins; else the shared file, else legacy.
      const inline = (personal?.setup !== undefined ? personal.setup : (await this.readSharedSetup(worktreePath)) ?? legacy ?? '').trim();
      if (files.length === 0 && !inline) return;

      const startedAt = new Date().toISOString();
      this.onSetupState({ path: worktreePath, state: 'running', startedAt });
      const errors: string[] = [];
      for (const scriptPath of files) {
        this.logger.info('Running hook script', { scriptPath, worktreePath, branch });
        try {
          await this.execFn('env', envArgv(env, ['bash', scriptPath]), { cwd: worktreePath, timeout: fileTimeoutMs });
          this.logger.info('Hook script completed', { scriptPath });
        } catch (err) {
          const stderr = (err as { stderr?: string }).stderr ?? (err instanceof Error ? err.message : String(err));
          this.logger.warn('Hook script failed', { scriptPath, stderr });
          errors.push(`${scriptPath}: ${stderr}`);
        }
      }
      if (inline) {
        const interpolated = interpolateHook(inline, { org, repo: name, branch, worktreePath });
        this.logger.info('Starting setup hook (async)', { repoKey, worktreePath, timeoutMs });
        try {
          await this.execFn('env', envArgv(env, ['bash', '-c', interpolated]), { cwd: worktreePath, timeout: timeoutMs });
          this.logger.info('Setup hook completed', { repoKey, worktreePath });
        } catch (err) {
          const stderr = (err as { stderr?: string }).stderr ?? (err instanceof Error ? err.message : String(err));
          this.logger.warn('Setup hook failed', { repoKey, worktreePath, stderr });
          errors.push(stderr);
        }
      }
      this.onSetupState({
        path: worktreePath,
        state: errors.length ? 'failed' : 'ok',
        startedAt,
        finishedAt: new Date().toISOString(),
        ...(errors.length ? { error: errors.join('\n').slice(-2000) } : {}),
      });
    })().catch((err) => {
      this.logger.warn('Failed to run setup hooks', { repoKey, error: err instanceof Error ? err.message : String(err) });
    });

    return personal?.setup !== undefined ? !!personal.setup.trim() : !!legacy?.trim();
  }

  /** Executable hook scripts of a hooks dir, sorted by name (absolute paths). */
  async listHookScripts(hooksDir: string): Promise<string[]> {
    if (!(await this.hostFs.exists(hooksDir))) return [];
    try {
      const entries = await this.hostFs.readdir(hooksDir);
      return entries.filter((e) => e.isFile).map((e) => e.name).sort((a, b) => a.localeCompare(b)).map((n) => `${hooksDir}/${n}`);
    } catch {
      return [];
    }
  }

  /** `hooks.setup` of the worktree's `.fleex/worktree.json`, if any. */
  private async readSharedSetup(worktreePath: string): Promise<string | undefined> {
    try {
      const parsed = JSON.parse(await this.hostFs.readFile(join(worktreePath, '.fleex', 'worktree.json'))) as { hooks?: { setup?: unknown } };
      return typeof parsed?.hooks?.setup === 'string' ? parsed.hooks.setup : undefined;
    } catch {
      return undefined;
    }
  }

  /** The FLEEX_* environment of a hook (the ticket id comes from the workspace manifest). */
  private async hookEnv(org: string, name: string, worktreePath: string, branch: string): Promise<Record<string, string>> {
    const workspacePath = dirname(worktreePath);
    let ticketId: string | undefined;
    try {
      const manifest = JSON.parse(await this.hostFs.readFile(join(workspacePath, '.fleex.json'))) as { ticketId?: unknown };
      if (typeof manifest.ticketId === 'string') ticketId = manifest.ticketId;
    } catch { /* not in a ticket workspace */ }
    const extra = await this.extraHookEnv(worktreePath).catch(() => ({}));
    return {
      ...buildFleexEnv({
        repo: `${org}/${name}`,
        repoPath: this.resolver.barePath(org, name),
        worktreePath,
        ...(ticketId ? { workspacePath, ticketId } : {}),
        branch,
      }),
      ...extra,
    };
  }

  /**
   * List overlay files for a repo (for UI display).
   */
  async listOverlayFiles(org: string, name: string): Promise<string[]> {
    const filesDir = this.resolver.overlayFilesDir(org, name);
    const exists = await this.hostFs.exists(filesDir);
    if (!exists) return [];

    const entries = await this.hostFs.readdir(filesDir);
    return entries.filter((e) => e.isFile).map((e) => e.name);
  }

  // ── Overlay sync (capture worktree ignored files → overlay) ───────────────

  /**
   * Discover every git worktree under a ticket's workspace root and scan each
   * for gitignored files. `rootPath` is the ticket's Current Working Directory:
   * its subdirectories are the individual repo worktrees. When `rootPath` is
   * itself a repo checkout (the standalone-worktree case) it is scanned directly.
   *
   * Discovery is filesystem-driven — we do not rely on live sessions — so a
   * worktree that exists on disk but has no running session is still found.
   * Each worktree's org/name is resolved from its own git remote so the scan
   * targets the correct `overlays/<org>/<name>` directory.
   */
  async scanWorkspace(rootPath: string): Promise<OverlaySyncRepoScan[]> {
    const repoDirs = await this.discoverWorktrees(rootPath);
    const scans: OverlaySyncRepoScan[] = [];
    for (const repoPath of repoDirs) {
      let org: string;
      let name: string;
      try {
        ({ org, name } = await this.git.getInfo(repoPath));
      } catch (err) {
        // No resolvable origin remote → not an overlay-managed repo. Skip it
        // rather than surfacing a bogus target.
        this.logger.debug('Skipping worktree without a resolvable git remote', {
          repoPath,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      // `_global` is a pseudo-repo with no overlay of its own; `unknown` means
      // the remote URL could not be parsed. Neither is a real sync target.
      if (!org || org.startsWith('_') || org === 'unknown') continue;
      scans.push(await this.scanForSync(org, name, repoPath));
    }
    return scans;
  }

  /**
   * List the git-worktree directories to scan for a given root.
   * - If the root is itself a repo checkout (`<root>/.git` exists — a directory
   *   for clones, a file for linked worktrees), it is the sole target.
   * - Otherwise the root is treated as a ticket workspace: every immediate
   *   subdirectory that carries a `.git` entry is a worktree target.
   */
  async discoverWorktrees(rootPath: string): Promise<string[]> {
    if (!rootPath) return [];
    if (await this.hostFs.exists(join(rootPath, '.git'))) return [rootPath];

    let entries: { name: string; isFile: boolean; isDirectory: boolean }[];
    try {
      entries = await this.hostFs.readdir(rootPath);
    } catch {
      return [];
    }

    const dirs: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const dir = join(rootPath, entry.name);
      if (await this.hostFs.exists(join(dir, '.git'))) dirs.push(dir);
    }
    return dirs.sort();
  }

  /**
   * Scan a single repo worktree for gitignored files and compare them to the
   * per-repo overlay. Returns a checkbox-ready tree plus the overlay's current
   * contents (with orphan flags) for the cleanup panel. `repoPath` is expected
   * to be a real repo checkout (as produced by {@link discoverWorktrees}); the
   * response echoes it so preview/apply target the same directory.
   */
  async scanForSync(org: string, name: string, repoPath: string): Promise<OverlaySyncRepoScan> {
    const overlayFilesDir = this.resolver.overlayFilesDir(org, name);
    const base = { org, name, worktreePath: repoPath, overlayFilesDir };

    if (!(await this.hostFs.exists(repoPath))) {
      return { ...base, available: false, message: 'Worktree unavailable locally', tree: [], overlayContents: [] };
    }

    let porcelain: string;
    try {
      const { stdout } = await this.execFn('git', ['status', '--ignored', '--porcelain', '-z'], {
        cwd: repoPath,
      });
      porcelain = stdout;
    } catch (err) {
      const message = (err as { stderr?: string }).stderr ?? (err instanceof Error ? err.message : String(err));
      return { ...base, available: false, message: `git status failed: ${message}`, tree: [], overlayContents: [] };
    }

    const { files, dirs } = parseIgnoredEntries(porcelain);
    const collapsedDirs: CollapsedDir[] = [];
    const flatFiles: string[] = [...files];

    for (const dir of dirs) {
      if (isDenylistedDir(dir)) {
        collapsedDirs.push({ relPath: dir, denylisted: true });
        continue;
      }
      const { files: expanded, truncated } = await this.expandDir(repoPath, dir);
      if (truncated) collapsedDirs.push({ relPath: dir, truncated: true });
      flatFiles.push(...expanded);
    }

    const fileNodes: OverlaySyncFileNode[] = [];
    for (const rel of flatFiles) {
      if (!isSafeRelPath(rel)) continue;
      fileNodes.push(await this.buildFileNode(repoPath, overlayFilesDir, rel));
    }

    const tree = buildTree(fileNodes, collapsedDirs);

    const overlayRel = await this.listOverlayFilesRecursive(org, name);
    const localSet = new Set(fileNodes.map((n) => n.relPath));
    const overlayContents = overlayRel.map((relPath) => ({ relPath, orphan: !localSet.has(relPath) }));

    return { ...base, available: true, tree, overlayContents };
  }

  /** Recursively list files in a repo's overlay, relative to the files dir. */
  async listOverlayFilesRecursive(org: string, name: string): Promise<string[]> {
    const filesDir = this.resolver.overlayFilesDir(org, name);
    if (!(await this.hostFs.exists(filesDir))) return [];

    const out: string[] = [];
    const walk = async (rel: string): Promise<void> => {
      if (out.length >= MAX_OVERLAY_ENTRIES) return;
      const abs = rel ? join(filesDir, rel) : filesDir;
      let entries: { name: string; isFile: boolean; isDirectory: boolean }[];
      try {
        entries = await this.hostFs.readdir(abs);
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= MAX_OVERLAY_ENTRIES) return;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory) await walk(childRel);
        else if (e.isFile) out.push(childRel);
      }
    };
    await walk('');
    return out.sort();
  }

  /** Bounded preview of a file on both the local and overlay side. */
  async previewFile(
    org: string,
    name: string,
    worktreePath: string,
    relPath: string,
  ): Promise<OverlaySyncPreviewResponse> {
    if (!isSafeRelPath(relPath)) throw new Error('Invalid relPath');
    const overlayFilesDir = this.resolver.overlayFilesDir(org, name);
    const localAbs = join(worktreePath, relPath);
    const overlayAbs = join(overlayFilesDir, relPath);
    const local = await this.readPreview(localAbs);
    const overlay = await this.readPreview(overlayAbs);
    const status = await this.computeStatus(localAbs, overlayAbs);
    return { relPath, status, local, overlay };
  }

  /**
   * Copy selected files into their overlays, recreating the tree (`mkdir -p`).
   * Additive by design: nothing is removed. Returns a per-file recap.
   */
  async copyToOverlay(items: OverlaySyncApplyItem[]): Promise<OverlaySyncApplyResponse> {
    const copied: OverlaySyncApplyResponse['copied'] = [];
    const errors: OverlaySyncApplyResponse['errors'] = [];

    for (const item of items) {
      const { org, name, worktreePath, relPath } = item;
      if (!isSafeRelPath(relPath)) {
        errors.push({ org, name, relPath, error: 'Unsafe relative path' });
        continue;
      }
      try {
        const overlayFilesDir = this.resolver.overlayFilesDir(org, name);
        const src = join(worktreePath, relPath);
        const dest = join(overlayFilesDir, relPath);
        const overwritten = await this.hostFs.exists(dest);
        await this.execFn('mkdir', ['-p', dirname(dest)]);
        await this.execFn('cp', ['-p', src, dest]);
        copied.push({ org, name, relPath, target: dest, overwritten });
        this.logger.info('Copied file to overlay', { org, name, relPath, dest });
      } catch (err) {
        errors.push({ org, name, relPath, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { copied, errors };
  }

  /** Explicitly remove files from a repo's overlay (cleanup gesture). */
  async removeFromOverlay(org: string, name: string, relPaths: string[]): Promise<OverlaySyncRemoveResponse> {
    const removed: OverlaySyncRemoveResponse['removed'] = [];
    const errors: OverlaySyncRemoveResponse['errors'] = [];
    const overlayFilesDir = this.resolver.overlayFilesDir(org, name);

    for (const relPath of relPaths) {
      if (!isSafeRelPath(relPath)) {
        errors.push({ relPath, error: 'Unsafe relative path' });
        continue;
      }
      try {
        const abs = join(overlayFilesDir, relPath);
        if (await this.hostFs.exists(abs)) await this.hostFs.rm(abs, { recursive: true });
        removed.push({ relPath });
        this.logger.info('Removed file from overlay', { org, name, relPath });
      } catch (err) {
        errors.push({ relPath, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { removed, errors };
  }

  // ── Sync internals ────────────────────────────────────────────────────────

  /** Walk a non-denylisted ignored directory into a bounded list of files. */
  private async expandDir(
    worktreePath: string,
    dirRel: string,
  ): Promise<{ files: string[]; truncated: boolean }> {
    const files: string[] = [];
    let truncated = false;

    const walk = async (rel: string): Promise<void> => {
      if (truncated) return;
      let entries: { name: string; isFile: boolean; isDirectory: boolean }[];
      try {
        entries = await this.hostFs.readdir(join(worktreePath, rel));
      } catch {
        return;
      }
      for (const e of entries) {
        if (truncated) return;
        const childRel = `${rel}/${e.name}`;
        if (e.isDirectory) {
          if (isDenylistedDir(childRel)) continue;
          await walk(childRel);
        } else if (e.isFile) {
          if (files.length >= MAX_EXPANDED_FILES) {
            truncated = true;
            return;
          }
          files.push(childRel);
        }
      }
    };

    await walk(dirRel);
    return { files, truncated };
  }

  private async buildFileNode(
    worktreePath: string,
    overlayFilesDir: string,
    rel: string,
  ): Promise<OverlaySyncFileNode> {
    const localAbs = join(worktreePath, rel);
    const overlayAbs = join(overlayFilesDir, rel);
    const localStat = await this.safeStat(localAbs);
    const overlayStat = await this.safeStat(overlayAbs);
    const status = await this.computeStatus(localAbs, overlayAbs, localStat, overlayStat);
    return {
      type: 'file',
      name: rel.split('/').pop() ?? rel,
      relPath: rel,
      status,
      size: localStat?.size ?? 0,
      localMtimeMs: localStat?.mtimeMs ?? null,
      overlayMtimeMs: overlayStat?.mtimeMs ?? null,
    };
  }

  private async computeStatus(
    localAbs: string,
    overlayAbs: string,
    localStat?: { size: number; mtimeMs: number } | null,
    overlayStat?: { size: number; mtimeMs: number } | null,
  ): Promise<OverlayFileStatus> {
    const oStat = overlayStat === undefined ? await this.safeStat(overlayAbs) : overlayStat;
    if (!oStat) return 'new';
    const lStat = localStat === undefined ? await this.safeStat(localAbs) : localStat;
    const lSize = lStat?.size ?? 0;
    if (lSize !== oStat.size) return 'modified';
    if (lSize > STATUS_READ_CAP_BYTES) return 'modified';
    const [localContent, overlayContent] = await Promise.all([
      this.safeRead(localAbs),
      this.safeRead(overlayAbs),
    ]);
    if (localContent === null || overlayContent === null) return 'modified';
    return classifyStatus(localContent, overlayContent);
  }

  private async readPreview(abs: string): Promise<OverlaySyncFilePreview | null> {
    const stat = await this.safeStat(abs);
    if (!stat) return null;
    if (stat.size > PREVIEW_MAX_READ_BYTES) {
      return { content: null, size: stat.size, mtimeMs: stat.mtimeMs, binary: false, truncated: true };
    }
    const raw = await this.safeRead(abs);
    if (raw === null) {
      return { content: null, size: stat.size, mtimeMs: stat.mtimeMs, binary: false, truncated: false };
    }
    if (raw.includes('\u0000')) {
      return { content: null, size: stat.size, mtimeMs: stat.mtimeMs, binary: true, truncated: false };
    }
    const truncated = raw.length > PREVIEW_CAP_BYTES;
    return {
      content: truncated ? raw.slice(0, PREVIEW_CAP_BYTES) : raw,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      binary: false,
      truncated,
    };
  }

  private async safeStat(abs: string): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      return await this.hostFs.stat(abs);
    } catch {
      return null;
    }
  }

  private async safeRead(abs: string): Promise<string | null> {
    try {
      return await this.hostFs.readFile(abs);
    } catch {
      return null;
    }
  }
}
