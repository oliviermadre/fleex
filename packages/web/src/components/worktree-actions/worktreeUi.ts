import type { WorktreeActionItem, WorktreeActionsView, WorktreeClickChoice, WorktreeServerState } from '@fleex/shared';
import { isWorktreeVerb } from '@fleex/shared';
import { tintSolid, tintText } from '../../lib/tints';

export const STATE_LABEL: Record<WorktreeServerState, string> = {
  stopped: 'stopped',
  starting: 'starting',
  running: 'running',
  error: 'error',
};

/** Green running, pulsing yellow starting, red error, grey stopped. */
export function stateDotClass(state: WorktreeServerState): string {
  switch (state) {
    case 'running': return tintSolid('green');
    case 'starting': return `${tintSolid('yellow')} animate-pulse motion-reduce:animate-none`;
    case 'error': return tintSolid('red');
    default: return 'bg-[var(--theme-text-muted)]';
  }
}

export function stateTextClass(state: WorktreeServerState): string {
  switch (state) {
    case 'running': return tintText('green');
    case 'starting': return tintText('yellow');
    case 'error': return tintText('red');
    default: return 'text-[var(--theme-text-muted)]';
  }
}

/** Menu groups, in display order (PRD §8.2). */
export type MenuGroupKind = 'pinned' | 'action' | 'launch' | 'npm' | 'make' | 'composer' | 'system';

export const GROUP_LABEL: Record<MenuGroupKind, string> = {
  pinned: '★ Épinglées',
  action: 'Actions du repo',
  launch: 'launch.json',
  npm: 'package.json',
  make: 'Makefile',
  composer: 'composer.json',
  system: 'Système',
};

export const FILTER_LABEL: Record<MenuGroupKind, string> = {
  pinned: '★ Épinglées',
  action: 'Actions',
  launch: 'launch.json',
  npm: 'npm',
  make: 'make',
  composer: 'composer',
  system: 'Système',
};

export const GROUP_ORDER: MenuGroupKind[] = ['pinned', 'action', 'launch', 'npm', 'make', 'composer', 'system'];

/** Source glyph and hue of a menu row. */
export const SOURCE_GLYPH: Record<Exclude<MenuGroupKind, 'pinned'>, { glyph: string; className: string }> = {
  action: { glyph: '⚡', className: tintText('yellow') },
  launch: { glyph: '▶', className: tintText('blue') },
  npm: { glyph: 'n', className: tintText('red') },
  make: { glyph: 'M', className: tintText('orange') },
  composer: { glyph: 'C', className: tintText('purple') },
  system: { glyph: '⚙', className: 'text-[var(--theme-text-muted)]' },
};

export function groupOf(item: Pick<WorktreeActionItem, 'source'>): Exclude<MenuGroupKind, 'pinned' | 'system'> {
  return item.source;
}

/** What the left click does, given the state — a verb, an item, or the menu. */
export type LeftClick =
  | { kind: 'verb'; verb: Exclude<WorktreeClickChoice, 'menu'> & string; label: string }
  | { kind: 'item'; item: WorktreeActionItem; label: string }
  | { kind: 'menu'; label: string };

const VERB_LABEL: Record<string, string> = {
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
  open: 'Open',
  logs: 'Logs',
  status: 'Refresh status',
};

/**
 * Resolve `clickByState` for the current state. Nothing to start (no
 * `server.start`) turns Start into "open the menu", which says why.
 */
export function resolveLeftClick(view: Pick<WorktreeActionsView, 'clickByState' | 'items' | 'start'>, state: WorktreeServerState): LeftClick {
  const choice = view.clickByState[state];
  if (!choice || choice === 'menu') return { kind: 'menu', label: 'Open the menu' };
  if (isWorktreeVerb(choice)) {
    if ((choice === 'start' || choice === 'restart') && !view.start) return { kind: 'menu', label: 'Open the menu (no start command configured)' };
    const detail = choice === 'start' && view.start ? ` (${view.start.command})` : '';
    return { kind: 'verb', verb: choice, label: `${VERB_LABEL[choice] ?? choice}${detail}` };
  }
  const item = view.items.find((i) => i.id === choice);
  return item ? { kind: 'item', item, label: item.label } : { kind: 'menu', label: 'Open the menu' };
}

/** `ticket/775c62-repo-actions` → `775c62-repo-acti…`: a short tag to tell two worktrees of one repo apart. */
export function shortBranch(branch: string): string {
  const last = branch.split('/').filter(Boolean).pop() ?? branch;
  return last.length > 14 ? `${last.slice(0, 13)}…` : last;
}
