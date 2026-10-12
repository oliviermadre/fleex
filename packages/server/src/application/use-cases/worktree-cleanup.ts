import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  WORKTREE_CLEANUP_SCHEMA_VERSION,
  parseCleanupOlderThan,
  type WorktreeCleanupBranchAction,
  type WorktreeCleanupEmptyWorkspace,
  type WorktreeCleanupOrphanLink,
  type WorktreeCleanupPrState,
  type WorktreeCleanupReport,
  type WorktreeCleanupSkippedTicket,
  type WorktreeCleanupStatus,
  type WorktreeCleanupTicket,
  type WorktreeCleanupUnknownDir,
  type WorktreeCleanupWorktree,
  type TicketLink,
} from '@fleex/shared';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { WorkspaceActivityProbe } from '../ports/workspace-activity-probe.port.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { AnyDomainEvent } from '../../domain/events.js';
import { parsePRRef } from '../../domain/services/pr-ref.js';
import { evaluateWorktreeGuards, isPathWithin, type WorktreeGuardFacts } from '../../domain/services/worktree-cleanup-guards.js';
import type { ExecFn, HostFs } from '../../infrastructure/host/types.js';

export interface WorktreeCleanupOptions {
  olderThan: string;
  statuses: WorktreeCleanupStatus[];
  /** Ticket UUID, `#123` or `123`. */
  ticket?: string | null;
  /** Compute disk sizes (`du`). */
  size: boolean;
}

export interface WorktreeCleanupDeps {
  basePath: string;
  git: GitPort;
  hostFs: HostFs;
  execFn: ExecFn;
  resolver: RepoPathResolver;
  ticketStore: TicketStorePort;
  /** Fetch a bare clone; false when the remote refs could not be refreshed. */
  fetchBare: (org: string, name: string) => Promise<boolean>;
  /** `org/name#N` → GitHub state. A missing key means unknown. */
  fetchPRStates: (prs: { org: string; name: string; number: number }[]) => Promise<Map<string, string>>;
  probe: WorkspaceActivityProbe;
  emit: (event: AnyDomainEvent) => void;
  logger: LoggerPort;
  now?: () => Date;
}

/** Thrown when an apply is already running: the HTTP layer answers 409. */
export class CleanupInProgressError extends Error {
  constructor() {
    super('A worktree cleanup is already running');
  }
}

/** Bad input (unparsable duration, unknown ticket): the HTTP layer answers 400. */
export class CleanupRequestError extends Error {}

const MANIFEST = '.fleex.json';
/** Files that do not make a workspace folder "non-empty". */
const DISPOSABLE_WORKSPACE_FILES = new Set([MANIFEST, '.DS_Store']);
const SIZE_CONCURRENCY = 4;
const DAY_MS = 86_400_000;
const ACTOR = 'worktree-cleanup';

interface Activity {
  panes: string[];
  /** null when the process check could not run. */
  processes: { pid: number; command?: string; cwd: string }[] | null;
}

/** What apply needs to act on one worktree, beyond the report row. */
interface WorktreeTarget {
  ticket: TicketEntity;
  workspacePath: string;
  row: WorktreeCleanupWorktree;
  org: string | null;
  name: string | null;
  barePath: string | null;
}

interface OrphanTarget {
  ticket: TicketEntity;
  row: WorktreeCleanupOrphanLink;
  link: TicketLink;
}

interface Plan {
  report: WorktreeCleanupReport;
  worktrees: WorktreeTarget[];
  orphans: OrphanTarget[];
  scopeTicketIds: Set<string>;
}

/**
 * `fleex worktree cleanup`: find the worktrees of tickets closed for a while,
 * decide per worktree whether it can go (guards: unpushed work, open PR, live
 * tmux pane / process…), and — on apply — remove the ones that can.
 *
 * The disk is the source of truth: workspace folders are tied to their ticket
 * by `.fleex.json` only (the folder name follows the title, which can change).
 * The ticket's `worktree` links are reconciled against it both ways.
 *
 * Apply never trusts a plan computed earlier: it recomputes it, then re-checks
 * every guard right before touching each worktree.
 */
export class WorktreeCleanupUseCase {
  private applying = false;

  constructor(private readonly deps: WorktreeCleanupDeps) {}

  async plan(opts: WorktreeCleanupOptions): Promise<WorktreeCleanupReport> {
    return (await this.buildPlan(opts)).report;
  }

  async apply(opts: WorktreeCleanupOptions, signal?: AbortSignal): Promise<WorktreeCleanupReport> {
    if (this.applying) throw new CleanupInProgressError();
    this.applying = true;
    try {
      return await this.runApply(opts, signal);
    } finally {
      this.applying = false;
    }
  }

  // ── Plan ──────────────────────────────────────────────────────────────────

  private async buildPlan(opts: WorktreeCleanupOptions): Promise<Plan> {
    const { resolver, ticketStore, hostFs } = this.deps;
    const olderThanMs = parseCleanupOlderThan(opts.olderThan);
    if (olderThanMs === null) throw new CleanupRequestError(`Invalid --older-than "${opts.olderThan}" (expected e.g. 36h, 14d, 2w)`);
    const now = this.now();
    const onlyTicketId = opts.ticket ? await this.resolveTicketId(opts.ticket) : null;

    const inScope = (t: TicketEntity): boolean =>
      (opts.statuses as string[]).includes(t.status) && now.getTime() - t.statusChangedAt.getTime() >= olderThanMs;

    const unknown: WorktreeCleanupUnknownDir[] = [];
    const skipped: WorktreeCleanupSkippedTicket[] = [];
    const emptyWorkspaces: WorktreeCleanupEmptyWorkspace[] = [];
    /** In-scope tickets → their workspace folder (null when only links remain). */
    const scope = new Map<string, { ticket: TicketEntity; workspacePath: string | null }>();
    const scanned = new Set<string>();

    // 1. The disk: every workspace folder, tied to its ticket by its manifest.
    const root = resolver.workspacesRoot();
    const entries = (await hostFs.exists(root)) ? await hostFs.readdir(root) : [];
    for (const entry of entries.filter((e) => e.isDirectory).sort((a, b) => a.name.localeCompare(b.name))) {
      const dir = join(root, entry.name);
      const manifest = await this.readManifest(dir);
      if (manifest.kind !== 'ok') {
        if (!onlyTicketId) unknown.push({ path: dir, reason: manifest.kind, ticketId: null, sizeBytes: null });
        continue;
      }
      if (onlyTicketId && manifest.ticketId !== onlyTicketId) continue;
      const ticket = await ticketStore.getTicketById(manifest.ticketId);
      if (!ticket) {
        unknown.push({ path: dir, reason: 'ticket_not_found', ticketId: manifest.ticketId, sizeBytes: null });
        continue;
      }
      scanned.add(ticket.id);
      if (!inScope(ticket)) {
        skipped.push({
          ticketId: ticket.id,
          displayId: ticket.displayId ?? null,
          title: ticket.title,
          status: ticket.status,
          closedForDays: (opts.statuses as string[]).includes(ticket.status) ? this.daysSince(ticket.statusChangedAt) : null,
        });
        continue;
      }
      scope.set(ticket.id, { ticket, workspacePath: dir });
    }

    // 2. The database: in-scope tickets whose worktree links outlived their folder.
    const allTickets = onlyTicketId
      ? [await ticketStore.getTicketById(onlyTicketId)].filter((t): t is TicketEntity => t !== null)
      : await ticketStore.getAllTickets();
    for (const ticket of allTickets) {
      if (scope.has(ticket.id) || !ticket.links.some((l) => l.type === 'worktree')) continue;
      scanned.add(ticket.id);
      if (inScope(ticket)) scope.set(ticket.id, { ticket, workspacePath: null });
    }

    // 3. Per ticket: worktrees + guards, orphan links, empty workspace.
    const activity = await this.readActivity();
    const run = new RunCache(this.deps);
    const tickets: WorktreeCleanupTicket[] = [];
    const worktrees: WorktreeTarget[] = [];
    const orphans: OrphanTarget[] = [];

    for (const { ticket, workspacePath } of scope.values()) {
      const row: WorktreeCleanupTicket = {
        ticketId: ticket.id,
        displayId: ticket.displayId ?? null,
        title: ticket.title,
        status: ticket.status,
        statusChangedAt: ticket.statusChangedAt.toISOString(),
        closedForDays: this.daysSince(ticket.statusChangedAt),
        workspacePath,
        worktrees: [],
        orphanLinks: [],
      };

      if (workspacePath) {
        const wtDirs = await this.listWorktreeDirs(workspacePath);
        for (const wt of wtDirs) {
          const target = await this.assessWorktree(ticket, workspacePath, wt, activity, run);
          row.worktrees.push(target.row);
          worktrees.push(target);
        }
        if (wtDirs.length === 0 && (await this.isDisposableWorkspace(workspacePath))) {
          emptyWorkspaces.push({ ticketId: ticket.id, displayId: ticket.displayId ?? null, path: workspacePath });
        }
      }

      for (const link of ticket.links.filter((l) => l.type === 'worktree')) {
        if (await this.isOrphanLink(link, run)) {
          const orphan: WorktreeCleanupOrphanLink = { linkId: link.id, ref: link.ref, label: link.label ?? null };
          row.orphanLinks.push(orphan);
          orphans.push({ ticket, row: orphan, link });
        }
      }

      if (row.worktrees.length > 0 || row.orphanLinks.length > 0) tickets.push(row);
    }

    tickets.sort((a, b) => (a.displayId ?? 0) - (b.displayId ?? 0));
    skipped.sort((a, b) => (a.displayId ?? 0) - (b.displayId ?? 0));

    if (opts.size) {
      const sized: { path: string; set: (n: number | null) => void }[] = [
        ...worktrees.map((w) => ({ path: w.row.path, set: (n: number | null) => { w.row.sizeBytes = n; } })),
        ...unknown.map((u) => ({ path: u.path, set: (n: number | null) => { u.sizeBytes = n; } })),
      ];
      await mapLimit(sized, SIZE_CONCURRENCY, async (s) => s.set(await this.diskUsage(s.path)));
    }

    const eligible = worktrees.filter((w) => w.row.decision === 'eligible');
    const report: WorktreeCleanupReport = {
      version: WORKTREE_CLEANUP_SCHEMA_VERSION,
      mode: 'plan',
      generatedAt: now.toISOString(),
      basePath: this.deps.basePath,
      criteria: {
        olderThan: opts.olderThan,
        olderThanDays: Math.round((olderThanMs / DAY_MS) * 100) / 100,
        statuses: opts.statuses,
        ticket: onlyTicketId,
      },
      tickets,
      skipped,
      emptyWorkspaces,
      unknown,
      totals: {
        ticketsScanned: scanned.size,
        ticketsInScope: scope.size,
        worktreesEligible: eligible.length,
        worktreesExcluded: worktrees.length - eligible.length,
        orphanLinks: orphans.length,
        emptyWorkspaces: emptyWorkspaces.length,
        unknownDirs: unknown.length,
        reclaimableBytes: opts.size ? eligible.reduce((sum, w) => sum + (w.row.sizeBytes ?? 0), 0) : null,
      },
    };
    return { report, worktrees, orphans, scopeTicketIds: new Set(scope.keys()) };
  }

  private async assessWorktree(
    ticket: TicketEntity,
    workspacePath: string,
    wtPath: string,
    activity: Activity,
    run: RunCache,
  ): Promise<WorktreeTarget> {
    const reg = await this.resolveRegistration(wtPath);
    const branch = reg.registration === 'ok' ? await this.deps.git.getHeadBranch(wtPath).catch(() => null) : null;
    const repo = reg.org && reg.name ? `${reg.org}/${reg.name}` : null;

    const facts: WorktreeGuardFacts = {
      registration: reg.registration,
      porcelain: '',
      overlayFiles: new Set(),
      unpushedCommits: 0,
      fetchFailed: false,
      prs: [],
      tmuxPanes: activity.panes.filter((p) => touches(p, wtPath, workspacePath)).length,
      processes: activity.processes === null
        ? null
        : activity.processes.filter((p) => touches(p.cwd, wtPath, workspacePath)).map(({ pid, command }) => ({ pid, command })),
    };

    let branchAction: WorktreeCleanupBranchAction = branch ? 'keep_local_unmerged' : 'none_detached';

    if (reg.registration === 'ok' && reg.org && reg.name && reg.barePath) {
      const { org, name, barePath } = reg;
      facts.fetchFailed = !(await run.fetched(org, name));
      facts.overlayFiles = await run.overlayFiles(org, name);

      // PRs of this ticket on this repo: their state, and their head ref (a
      // squash-merged branch is gone from origin; its commits live on there).
      const prNumbers = ticket.links
        .filter((l) => l.type === 'github_pr')
        .map((l) => parsePRRef(l.ref))
        .filter((p): p is NonNullable<typeof p> => p !== null && p.org === org && p.name === name)
        .map((p) => p.number);
      const states = await run.prStates(ticket);
      const prRefs: string[] = [];
      for (const number of [...new Set(prNumbers)]) {
        const raw = states.get(`${org}/${name}#${number}`);
        const state: WorktreeCleanupPrState = raw === 'OPEN' || raw === 'MERGED' || raw === 'CLOSED' ? raw : 'UNKNOWN';
        facts.prs.push({ number, state });
        if (await run.fetchedPullRef(barePath, number)) prRefs.push(pullRef(number));
        else facts.fetchFailed = true;
      }

      facts.porcelain = await this.deps.git.getStatusPorcelain(wtPath, { untrackedAll: true }).catch(() => null);
      facts.unpushedCommits = await this.deps.git.countCommitsNotOnRemotes(wtPath, prRefs).catch(() => null);

      if (branch) {
        branchAction = (await this.isBranchMerged(barePath, branch, facts.prs, prRefs, run))
          ? 'delete_local_merged'
          : 'keep_local_unmerged';
      }
    }

    const verdict = evaluateWorktreeGuards(facts);
    return {
      ticket,
      workspacePath,
      org: reg.org,
      name: reg.name,
      barePath: reg.barePath,
      row: {
        path: wtPath,
        repo,
        branch,
        sizeBytes: null,
        decision: verdict.decision,
        reasons: verdict.reasons,
        details: verdict.details,
        branchAction,
      },
    };
  }

  /** Merged ⇔ the tip is on origin's default branch, or on the head of a merged PR. */
  private async isBranchMerged(
    barePath: string,
    branch: string,
    prs: { number: number; state: WorktreeCleanupPrState }[],
    prRefs: string[],
    run: RunCache,
  ): Promise<boolean> {
    const { git } = this.deps;
    const defaultBranch = await run.defaultBranch(barePath);
    if (defaultBranch && (await git.isAncestor(barePath, branch, `origin/${defaultBranch}`))) return true;
    for (const pr of prs) {
      if (pr.state !== 'MERGED' || !prRefs.includes(pullRef(pr.number))) continue;
      if (await git.isAncestor(barePath, branch, pullRef(pr.number))) return true;
    }
    return false;
  }

  /**
   * A worktree's `.git` is a file `gitdir: <bare>/worktrees/<x>`. The worktree
   * is only handled when that bare is one of ours and lists this path.
   */
  private async resolveRegistration(wtPath: string): Promise<{
    registration: WorktreeGuardFacts['registration'];
    org: string | null;
    name: string | null;
    barePath: string | null;
  }> {
    const none = { org: null, name: null, barePath: null };
    const dotGit = join(wtPath, '.git');
    const entry = (await this.deps.hostFs.readdir(wtPath)).find((e) => e.name === '.git');
    if (!entry) return { registration: 'unregistered_worktree', ...none };
    if (entry.isDirectory) return { registration: 'not_a_worktree', ...none };

    const content = await this.deps.hostFs.readFile(dotGit).catch(() => '');
    const m = /^gitdir:\s*(.+)$/m.exec(content);
    if (!m) return { registration: 'unregistered_worktree', ...none };
    const gitdir = isAbsolute(m[1]!.trim()) ? m[1]!.trim() : resolve(wtPath, m[1]!.trim());
    const idx = gitdir.lastIndexOf('/worktrees/');
    if (idx < 0) return { registration: 'unregistered_worktree', ...none };
    const barePath = gitdir.slice(0, idx);

    const rel = relative(this.deps.resolver.bareRootDir(), barePath).split('/');
    if (rel.length !== 2 || rel[0] === '..' || !rel[1]!.endsWith('.git')) {
      return { registration: 'unregistered_worktree', ...none };
    }
    const org = rel[0]!;
    const name = rel[1]!.slice(0, -'.git'.length);
    const listed = await this.deps.git.listWorktrees(barePath).catch(() => []);
    if (!listed.some((w) => w.path === wtPath)) return { registration: 'unregistered_worktree', org, name, barePath: null };
    return { registration: 'ok', org, name, barePath };
  }

  /**
   * A `worktree` link is an orphan only when we can tell, on THIS machine, that
   * its target is gone. The database is shared between machines: a link created
   * elsewhere (path outside our basePath, bare clone we don't have) is foreign,
   * never an orphan.
   */
  private async isOrphanLink(link: TicketLink, run: RunCache): Promise<boolean> {
    const { resolver, hostFs } = this.deps;
    if (link.ref.startsWith('/')) {
      if (!isPathWithin(link.ref, resolver.workspacesRoot())) return false;
      return !(await hostFs.exists(link.ref));
    }
    const m = /^([^/:]+)\/([^/:]+):(.+)$/.exec(link.ref);
    if (!m) return false;
    const barePath = resolver.barePath(m[1]!, m[2]!);
    if (!(await hostFs.exists(barePath))) return false;
    const listed = await run.worktreeBranches(barePath);
    return listed !== null && !listed.has(m[3]!);
  }

  // ── Apply ─────────────────────────────────────────────────────────────────

  private async runApply(opts: WorktreeCleanupOptions, signal?: AbortSignal): Promise<WorktreeCleanupReport> {
    const plan = await this.buildPlan(opts);
    const report = plan.report;
    report.mode = 'apply';
    const totals = { removed: 0, skipped: 0, failed: 0, freedBytes: 0, purgedLinks: 0 };
    const run = new RunCache(this.deps);
    let interrupted = false;

    for (const target of plan.worktrees.filter((w) => w.row.decision === 'eligible')) {
      // Stop between two worktrees, never in the middle of one.
      if (signal?.aborted) { interrupted = true; break; }
      const row = target.row;
      try {
        // a. Re-check: the ticket and every guard, right before deleting.
        const fresh = await this.deps.ticketStore.getTicketById(target.ticket.id);
        if (!fresh || !(opts.statuses as string[]).includes(fresh.status)) {
          row.result = 'skipped_guard';
          row.error = 'ticket reopened or deleted since the plan';
          totals.skipped++;
          continue;
        }
        const recheck = await this.assessWorktree(fresh, target.workspacePath, row.path, await this.readActivity(), run);
        if (recheck.row.decision !== 'eligible' || !target.barePath) {
          row.result = 'skipped_guard';
          row.reasons = recheck.row.reasons;
          row.details = recheck.row.details;
          totals.skipped++;
          continue;
        }

        // b. Remove. --force only because (a) just proved there is nothing to
        //    lose: overlay files left untracked make a plain remove refuse.
        await this.deps.git.removeWorktree(target.barePath, row.path);
        // c. Forget the worktree's admin entry in the bare.
        await this.deps.git.pruneWorktrees(target.barePath).catch((err) => this.warn('worktree prune failed', row.path, err));
        // d. Local branch: only when merged. The remote branch is never touched.
        if (row.branch && recheck.row.branchAction === 'delete_local_merged') {
          await this.deps.git.deleteLocalBranch(target.barePath, row.branch).catch((err) => this.warn('branch delete failed', row.path, err));
        }
        row.branchAction = recheck.row.branchAction;
        this.deps.emit({
          type: 'worktree.deleted',
          repoPath: target.barePath,
          worktreePath: row.path,
          ...(row.branch ? { branch: row.branch } : {}),
          occurredAt: new Date(),
        });
        // e. Drop the ticket's link(s) to it, or a reopened ticket would recreate it.
        const refs = new Set([row.path, ...(row.branch && row.repo ? [`${row.repo}:${row.branch}`] : [])]);
        await this.removeLinks(fresh, fresh.links.filter((l) => l.type === 'worktree' && refs.has(l.ref)));
        // f. The workspace folder goes once nothing but the manifest is left.
        if (await this.isDisposableWorkspace(target.workspacePath)) {
          await this.deps.hostFs.rm(target.workspacePath, { recursive: true });
        }
        row.result = 'removed';
        totals.removed++;
        totals.freedBytes += row.sizeBytes ?? 0;
      } catch (err) {
        row.result = 'failed';
        row.error = err instanceof Error ? err.message : String(err);
        totals.failed++;
        this.warn('worktree cleanup failed', row.path, err);
      }
    }

    if (!interrupted) {
      for (const orphan of plan.orphans) {
        if (signal?.aborted) { interrupted = true; break; }
        try {
          const fresh = await this.deps.ticketStore.getTicketById(orphan.ticket.id);
          const link = fresh?.findLinkById(orphan.link.id);
          // Already gone (purged with its worktree above, or by someone else).
          if (!fresh || !link) { orphan.row.result = 'purged'; totals.purgedLinks++; continue; }
          if (!(await this.isOrphanLink(link, new RunCache(this.deps)))) continue;
          await this.removeLinks(fresh, [link]);
          orphan.row.result = 'purged';
          totals.purgedLinks++;
        } catch (err) {
          orphan.row.result = 'failed';
          orphan.row.error = err instanceof Error ? err.message : String(err);
          totals.failed++;
        }
      }
    }

    if (!interrupted) {
      for (const ws of report.emptyWorkspaces) {
        try {
          if (await this.isDisposableWorkspace(ws.path)) await this.deps.hostFs.rm(ws.path, { recursive: true });
          ws.result = 'removed';
        } catch (err) {
          ws.result = 'failed';
          ws.error = err instanceof Error ? err.message : String(err);
          totals.failed++;
        }
      }
    }

    report.totals = { ...report.totals, ...totals };
    if (interrupted) report.interrupted = true;
    return report;
  }

  /** Same bookkeeping as `DELETE /api/tickets/:id/links/:linkId`. */
  private async removeLinks(ticket: TicketEntity, links: TicketLink[]): Promise<void> {
    if (links.length === 0) return;
    for (const link of links) ticket.removeLink(link.id);
    await this.deps.ticketStore.saveTicket(ticket);
    for (const link of links) {
      await this.deps.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: ticket.id,
        action: 'unlinked',
        changes: { link: { from: link, to: null } },
        actorName: ACTOR,
        source: 'api',
      }));
      this.deps.emit({
        type: 'ticket.linkRemoved',
        ticketId: ticket.id,
        linkType: link.type,
        ref: link.ref,
        label: link.label,
        occurredAt: new Date(),
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private daysSince(date: Date): number {
    return Math.floor((this.now().getTime() - date.getTime()) / DAY_MS);
  }

  private async resolveTicketId(ref: string): Promise<string> {
    const m = /^#?(\d+)$/.exec(ref.trim());
    const ticket = m
      ? await this.deps.ticketStore.getTicketByDisplayId(Number(m[1]))
      : await this.deps.ticketStore.getTicketById(ref.trim());
    if (!ticket) throw new CleanupRequestError(`Ticket not found: ${ref}`);
    return ticket.id;
  }

  private async readManifest(dir: string): Promise<{ kind: 'ok'; ticketId: string } | { kind: 'no_manifest' | 'manifest_invalid' | 'routine_workspace' }> {
    const path = join(dir, MANIFEST);
    if (!(await this.deps.hostFs.exists(path))) return { kind: 'no_manifest' };
    try {
      const parsed = JSON.parse(await this.deps.hostFs.readFile(path)) as { ticketId?: unknown; routineId?: unknown };
      if (typeof parsed.ticketId === 'string' && parsed.ticketId) return { kind: 'ok', ticketId: parsed.ticketId };
      if (typeof parsed.routineId === 'string' && parsed.routineId) return { kind: 'routine_workspace' };
    } catch {
      // fall through
    }
    return { kind: 'manifest_invalid' };
  }

  /** Sub-folders holding a `.git` entry (a worktree, or something pretending to be one). */
  private async listWorktreeDirs(workspacePath: string): Promise<string[]> {
    const out: string[] = [];
    for (const e of await this.deps.hostFs.readdir(workspacePath)) {
      if (!e.isDirectory) continue;
      const dir = join(workspacePath, e.name);
      if (await this.deps.hostFs.exists(join(dir, '.git'))) out.push(dir);
    }
    return out.sort();
  }

  /** Nothing in the folder but the manifest (and Finder litter). */
  private async isDisposableWorkspace(path: string): Promise<boolean> {
    if (!(await this.deps.hostFs.exists(path))) return false;
    const entries = await this.deps.hostFs.readdir(path);
    return entries.every((e) => DISPOSABLE_WORKSPACE_FILES.has(e.name));
  }

  private async readActivity(): Promise<Activity> {
    // A tmux we cannot read could hide a live session: fail the whole run
    // rather than guess (the probe already maps "no tmux server" to []).
    const panes = await this.deps.probe.panePaths();
    const processes = await this.deps.probe.processCwds().catch((err) => {
      this.warn('process check failed', '', err);
      return null;
    });
    return { panes, processes };
  }

  private async diskUsage(path: string): Promise<number | null> {
    try {
      const { stdout } = await this.deps.execFn('du', ['-sk', path], { timeout: 10 * 60_000 });
      const kb = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? '', 10);
      return Number.isNaN(kb) ? null : kb * 1024;
    } catch {
      return null;
    }
  }

  private warn(msg: string, path: string, err: unknown): void {
    this.deps.logger.warn(`Worktree cleanup: ${msg}`, { path, error: err instanceof Error ? err.message : String(err) });
  }
}

/** A pane / process "is in" a worktree when its cwd is the worktree or below, or the workspace root holding it. */
function touches(cwd: string, wtPath: string, workspacePath: string): boolean {
  return isPathWithin(cwd, wtPath) || cwd === workspacePath || cwd === `${workspacePath}/`;
}

function pullRef(number: number): string {
  return `refs/pull/${number}/head`;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

/** Network and git lookups done once per run, whatever the number of worktrees. */
class RunCache {
  private readonly fetches = new Map<string, Promise<boolean>>();
  private readonly pullRefs = new Map<string, Promise<boolean>>();
  private readonly overlays = new Map<string, Promise<Set<string>>>();
  private readonly defaults = new Map<string, Promise<string | null>>();
  private readonly branches = new Map<string, Promise<Set<string> | null>>();
  private readonly states = new Map<string, Promise<Map<string, string>>>();

  constructor(private readonly deps: WorktreeCleanupDeps) {}

  fetched(org: string, name: string): Promise<boolean> {
    return memo(this.fetches, `${org}/${name}`, () => this.deps.fetchBare(org, name));
  }

  fetchedPullRef(barePath: string, number: number): Promise<boolean> {
    const ref = pullRef(number);
    return memo(this.pullRefs, `${barePath}#${number}`, () =>
      this.deps.git.fetchRef(barePath, `+${ref}:${ref}`).then(() => true, () => false));
  }

  defaultBranch(barePath: string): Promise<string | null> {
    return memo(this.defaults, barePath, () => this.deps.git.getDefaultBranch(barePath).catch(() => null));
  }

  worktreeBranches(barePath: string): Promise<Set<string> | null> {
    return memo(this.branches, barePath, () =>
      this.deps.git.listWorktrees(barePath).then((wts) => new Set(wts.map((w) => w.branch)), () => null));
  }

  /** PR states of one ticket, fetched in a single GraphQL call. */
  prStates(ticket: TicketEntity): Promise<Map<string, string>> {
    return memo(this.states, ticket.id, async () => {
      const prs = ticket.links
        .filter((l) => l.type === 'github_pr')
        .map((l) => parsePRRef(l.ref))
        .filter((p): p is NonNullable<typeof p> => p !== null);
      if (prs.length === 0) return new Map();
      return this.deps.fetchPRStates(prs).catch(() => new Map<string, string>());
    });
  }

  /** Overlay files (global + repo), as paths relative to a worktree root. */
  overlayFiles(org: string, name: string): Promise<Set<string>> {
    return memo(this.overlays, `${org}/${name}`, async () => {
      const files = new Set<string>();
      for (const dir of [this.deps.resolver.globalOverlayFilesDir(), this.deps.resolver.overlayFilesDir(org, name)]) {
        await this.walk(dir, '', files);
      }
      return files;
    });
  }

  private async walk(root: string, rel: string, into: Set<string>): Promise<void> {
    const abs = rel ? join(root, rel) : root;
    if (!(await this.deps.hostFs.exists(abs))) return;
    for (const e of await this.deps.hostFs.readdir(abs)) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory) await this.walk(root, child, into);
      else into.add(child);
    }
  }
}

function memo<T>(cache: Map<string, Promise<T>>, key: string, fn: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = fn();
    cache.set(key, p);
  }
  return p;
}
