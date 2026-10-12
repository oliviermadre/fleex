import os from 'node:os';
import chalk from 'chalk';
import type { WorktreeCleanupReport, WorktreeCleanupTicket, WorktreeCleanupWorktree } from '@fleex/shared';

/**
 * Text rendering of a cleanup report: sections coloured by what happens to
 * them — green goes, red stays, yellow is bookkeeping, magenta is left alone.
 * Pure (returns a string) so it can be snapshot-tested.
 */

const ANSI = /\x1b\[[0-9;]*m/g;
const visible = (s: string): number => s.replace(ANSI, '').length;
function pad(s: string, width: number): string {
  const v = visible(s);
  if (v > width) return `${s.replace(ANSI, '').slice(0, Math.max(0, width - 1))}…`;
  return s + ' '.repeat(width - v);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

function home(p: string): string {
  const h = os.homedir();
  return p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
}

const ticketId = (t: { displayId: number | null }): string => chalk.blue(t.displayId !== null ? `#${t.displayId}` : '#?');
const repoName = (w: WorktreeCleanupWorktree): string => (w.repo ? w.repo.split('/')[1]! : w.path.split('/').pop()!);
const sumSize = (wts: WorktreeCleanupWorktree[]): number | null =>
  wts.some((w) => w.sizeBytes === null) ? null : wts.reduce((s, w) => s + (w.sizeBytes ?? 0), 0);

/** `unpushed_commits (3 commits), untracked_files (2)` — the code stays greppable. */
export function reasonText(w: WorktreeCleanupWorktree): string {
  return w.reasons.map((r) => {
    switch (r) {
      case 'unpushed_commits': return `${r} (${w.details.unpushedCommits} commit${w.details.unpushedCommits > 1 ? 's' : ''})`;
      case 'untracked_files': return `${r} (${w.details.untracked.length})`;
      case 'dirty': return `${r} (${w.details.dirtyLines} line${w.details.dirtyLines > 1 ? 's' : ''})`;
      case 'pr_open': return `${r} (${w.details.prs.filter((p) => p.state === 'OPEN').map((p) => `#${p.number}`).join(', ')})`;
      case 'pr_state_unknown': return `${r} (${w.details.prs.filter((p) => p.state === 'UNKNOWN').map((p) => `#${p.number}`).join(', ')})`;
      case 'process_running': return `${r} (${w.details.processes.map((p) => `${p.command ?? '?'} ${p.pid}`).join(', ')})`;
      default: return r;
    }
  }).join(', ');
}

function branchNote(w: WorktreeCleanupWorktree): string {
  switch (w.branchAction) {
    case 'delete_local_merged': return 'local branch deleted (merged)';
    case 'keep_local_unmerged': return 'local branch kept (not merged)';
    default: return 'detached HEAD';
  }
}

export function renderHeader(report: Pick<WorktreeCleanupReport, 'criteria' | 'basePath'>, mode: 'dry-run' | 'apply'): string {
  const c = report.criteria;
  return `${chalk.bold.white(`Worktree cleanup — ${mode}`)}  ${chalk.dim(`(${c.statuses.join(',')} · closed ≥ ${c.olderThan} · basePath ${home(report.basePath)}${c.ticket ? ` · ticket ${c.ticket}` : ''})`)}\n`;
}

const ORPHAN_SAMPLE = 10;

const eligibleOf = (t: WorktreeCleanupTicket) => t.worktrees.filter((w) => w.decision === 'eligible');
const excludedOf = (t: WorktreeCleanupTicket) => t.worktrees.filter((w) => w.decision === 'excluded');

/** The plan: what goes, what stays (and why), links to purge, folders left alone. */
export function renderPlan(report: WorktreeCleanupReport, opts: { verbose?: boolean } = {}): string {
  const out: string[] = [renderHeader(report, 'dry-run')];
  const t = report.totals;

  // TO REMOVE — biggest first.
  const removable = report.tickets.filter((x) => eligibleOf(x).length > 0)
    .sort((a, b) => (sumSize(eligibleOf(b)) ?? 0) - (sumSize(eligibleOf(a)) ?? 0));
  out.push(`${chalk.bold.green('TO REMOVE')}  ${chalk.green(`${t.worktreesEligible} worktree${t.worktreesEligible === 1 ? '' : 's'}${t.reclaimableBytes !== null ? ` · ${formatBytes(t.reclaimableBytes)}` : ''}`)}`);
  for (const x of removable) {
    const e = eligibleOf(x);
    const kept = excludedOf(x).length;
    out.push(`  ${pad(ticketId(x), 6)} ${pad(x.title, 34)} ${pad(x.status, 10)}${pad(`${x.closedForDays} d`, 6)}${pad(`${e.length} wt`, 6)}${formatBytes(sumSize(e))}${kept ? chalk.yellow(` (+${kept} kept)`) : ''}`);
    if (opts.verbose) {
      for (const w of e) out.push(`      ${chalk.dim('└')} ${pad(repoName(w), 24)} ${pad(formatBytes(w.sizeBytes), 9)} ${chalk.dim(branchNote(w))}`);
    }
  }

  // KEPT — every reason, by ticket number.
  out.push('', `${chalk.bold.red('KEPT')}  ${chalk.red(`${t.worktreesExcluded} worktree${t.worktreesExcluded === 1 ? '' : 's'}`)}`);
  for (const x of report.tickets) {
    for (const w of excludedOf(x)) {
      out.push(`  ${pad(ticketId(x), 6)} ${pad(x.title, 30)} ${pad(repoName(w), 16)} ${chalk.red(reasonText(w))}`);
    }
  }

  out.push('', `${chalk.bold.yellow('ORPHAN LINKS TO PURGE')}  ${chalk.yellow(String(t.orphanLinks))}`);
  // Hundreds after months without cleanup: a sample unless -v.
  const orphanLines = report.tickets.flatMap((x) =>
    x.orphanLinks.map((l) => `  ${pad(ticketId(x), 6)} ${pad(x.title, 30)} ${chalk.dim(`${home(l.ref)} (absent)`)}`));
  const shown = opts.verbose ? orphanLines : orphanLines.slice(0, ORPHAN_SAMPLE);
  out.push(...shown);
  if (shown.length < orphanLines.length) out.push(chalk.dim(`  … ${orphanLines.length - shown.length} more (-v to list them all)`));

  if (report.emptyWorkspaces.length > 0) {
    out.push('', `${chalk.bold.yellow('EMPTY WORKSPACES')} ${chalk.dim('(only .fleex.json)')}  ${report.emptyWorkspaces.length}`);
    for (const e of report.emptyWorkspaces) out.push(`  ${pad(ticketId(e), 6)} ${home(e.path)}`);
  }

  out.push('', `${chalk.bold.magenta('UNKNOWN FOLDERS')} ${chalk.dim('(reported, never touched)')}  ${t.unknownDirs}`);
  // Routine runs pile up by the hundred: one summary line, the detail is in --json.
  const routines = report.unknown.filter((u) => u.reason === 'routine_workspace');
  for (const u of report.unknown.filter((x) => x.reason !== 'routine_workspace')) {
    out.push(`  ${pad(u.path.split('/').pop()!, 34)} ${chalk.magenta(pad(u.reason, 18))}${formatBytes(u.sizeBytes)}`);
  }
  if (routines.length > 0) {
    const size = routines.some((u) => u.sizeBytes === null) ? '' : formatBytes(routines.reduce((s, u) => s + (u.sizeBytes ?? 0), 0));
    out.push(`  ${pad(`${routines.length} routine run folder${routines.length === 1 ? '' : 's'}`, 34)} ${chalk.magenta(pad('routine_workspace', 18))}${size}`);
  }

  if (opts.verbose && report.skipped.length > 0) {
    out.push('', `${chalk.bold.dim('BELOW THRESHOLD')} ${chalk.dim(`(not closed, or closed < ${report.criteria.olderThan})`)}`);
    for (const s of report.skipped) {
      out.push(chalk.dim(`  ${pad(`#${s.displayId ?? '?'}`, 6)} ${pad(s.title, 34)} ${pad(s.status, 10)}${s.closedForDays !== null ? `${s.closedForDays} d` : ''}`));
    }
  }

  out.push('');
  return out.join('\n') + '\n';
}

/** What `--apply` did, worktree by worktree, then the totals. */
export function renderApply(report: WorktreeCleanupReport): string {
  const out: string[] = [renderHeader(report, 'apply')];
  const t = report.totals;
  for (const x of report.tickets) {
    for (const w of x.worktrees) {
      if (!w.result) continue;
      const where = `${pad(ticketId(x), 6)} ${pad(repoName(w), 22)}`;
      if (w.result === 'removed') {
        const branch = w.branchAction === 'delete_local_merged' ? 'branch -D' : w.branchAction === 'none_detached' ? 'detached' : 'branch kept';
        out.push(`  ${chalk.green('✓')} ${where} ${chalk.dim(`re-check ✓ · worktree remove · prune · ${branch} · link removed`)}  ${chalk.green('removed')}`);
      } else if (w.result === 'skipped_guard') {
        out.push(`  ${chalk.yellow('↷')} ${where} ${chalk.dim(`re-check ✗ ${w.reasons.length ? reasonText(w) : (w.error ?? '')} · worktree intact`)}  ${chalk.yellow('skipped_guard')}`);
      } else {
        out.push(`  ${chalk.red('✗')} ${where} ${chalk.red(w.error ?? 'failed')}  ${chalk.red('failed')}`);
      }
    }
    for (const l of x.orphanLinks) {
      if (!l.result) continue;
      out.push(l.result === 'purged'
        ? `  ${chalk.green('✓')} ${pad(ticketId(x), 6)} orphan link  ${chalk.dim(home(l.ref))}  ${chalk.green('purged')}`
        : `  ${chalk.red('✗')} ${pad(ticketId(x), 6)} orphan link  ${chalk.dim(home(l.ref))}  ${chalk.red(l.error ?? 'failed')}`);
    }
  }
  for (const e of report.emptyWorkspaces) {
    out.push(e.result === 'removed'
      ? `  ${chalk.green('✓')} empty workspace ${home(e.path)} removed`
      : `  ${chalk.red('✗')} empty workspace ${home(e.path)}  ${chalk.red(e.error ?? 'failed')}`);
  }

  const kept = t.worktreesExcluded;
  out.push('');
  const summary = `Done: ${t.removed ?? 0} removed · ${t.skipped ?? 0} skipped_guard · ${t.failed ?? 0} failed · ${formatBytes(t.freedBytes ?? 0)} freed · ${t.purgedLinks ?? 0} link${t.purgedLinks === 1 ? '' : 's'} purged`;
  out.push((t.failed ?? 0) > 0 ? chalk.bold.red(summary) : chalk.bold.green(summary));
  if (kept > 0) out.push(chalk.dim(`${kept} worktree${kept === 1 ? '' : 's'} kept by a guard — run without --apply to see why.`));
  if (report.interrupted) out.push(chalk.yellow('Interrupted: stopped before the next worktree. Run again to finish.'));
  out.push('');
  return out.join('\n') + '\n';
}

/** Anything for `--apply` to do? */
export function hasWork(report: WorktreeCleanupReport): boolean {
  return report.totals.worktreesEligible + report.totals.orphanLinks + report.totals.emptyWorkspaces > 0;
}
