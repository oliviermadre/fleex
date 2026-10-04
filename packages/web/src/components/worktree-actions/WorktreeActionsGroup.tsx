import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import type { Ticket, WorktreeActionsView } from '@fleex/shared';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorktreeActionsStore, worktreeName } from '../../stores/worktreeActionsStore';
import { buildWorkspaceContext } from '../../lib/templateUtils';
import { GROUP_LABEL } from '../work/topBarStyles';
import { WorktreeActionButton } from './WorktreeActionButton';
import { STATE_LABEL, shortBranch, stateDotClass } from './worktreeUi';

/** Beyond this many worktrees, the rest go behind a `+N ▾` button (PRD §8.1). */
export const MAX_VISIBLE_WORKTREES = 4;

const EMPTY: WorktreeActionsView[] = [];

/** Button labels: the repo name, plus a branch tag when one repo has several worktrees in the ticket. */
export function worktreeLabels(views: WorktreeActionsView[]): string[] {
  const names = views.map(worktreeName);
  return views.map((v, i) => (names.filter((n) => n === names[i]).length > 1 ? `${names[i]}·${shortBranch(v.branch)}` : names[i]!));
}

/**
 * WORKTREES group (PRD §8.1): one button per worktree found in the ticket's
 * workspace, sorted by repo then branch. Renders nothing until the ticket has
 * a worktree.
 */
export function WorktreeActionsGroup({ ticket, separator = false }: { ticket: Ticket; separator?: boolean }) {
  const basePath = useSettingsStore((s) => s.settings.basePath);
  // Without the base path (settings not loaded yet) the workspace path is meaningless.
  const root = useMemo(() => (basePath ? buildWorkspaceContext(ticket, basePath).workspace_path : ''), [ticket, basePath]);
  const views = useWorktreeActionsStore((s) => (root ? s.byRoot[root] : undefined)) ?? EMPTY;
  const load = useWorktreeActionsStore((s) => s.load);

  useEffect(() => {
    if (root) void load(root);
  }, [root, load]);

  const labels = useMemo(() => worktreeLabels(views), [views]);
  // A worktree picked from the overflow list joins the bar (and opens its menu).
  const [picked, setPicked] = useState<{ path: string; nonce: number } | null>(null);
  if (!root || views.length === 0) return null;

  const indexed = views.map((view, i) => ({ view, label: labels[i]! }));
  const visible = indexed.slice(0, MAX_VISIBLE_WORKTREES);
  const extra = picked ? indexed.find((x) => x.view.path === picked.path && !visible.includes(x)) : undefined;
  if (extra) visible.push(extra);
  const hidden = indexed.filter((x) => !visible.includes(x));

  return (
    <>
      {separator && <div className="mx-1 h-4 w-px bg-[var(--theme-border)]" />}
      <span className={GROUP_LABEL}>WORKTREES</span>
      <div className="flex items-center gap-1.5">
        {visible.map(({ view, label }) => (
          <WorktreeActionButton key={view.path} view={view} root={root} ticketId={ticket.id} label={label} {...(picked?.path === view.path ? { openNonce: picked.nonce } : {})} />
        ))}
        {hidden.length > 0 && <OverflowButton items={hidden} onPick={(path) => setPicked({ path, nonce: Date.now() })} />}
      </div>
    </>
  );
}

function OverflowButton({ items, onPick }: { items: { view: WorktreeActionsView; label: string }[]; onPick: (path: string) => void }) {
  const servers = useWorktreeActionsStore((s) => s.servers);
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ placement: 'bottom-end' });
  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        {...getReferenceProps()}
        aria-label={`${items.length} autres worktrees`}
        className="flex h-6 shrink-0 items-center gap-1 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-2 text-[11px] font-medium text-[var(--theme-text-secondary)] hover:border-[var(--theme-accent)]"
      >
        +{items.length} <span aria-hidden>▾</span>
      </button>
      {open && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-50 min-w-[220px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl">
            {items.map(({ view, label }) => {
              const state = (servers[view.path] ?? view.server).state;
              return (
                <button
                  key={view.path}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onPick(view.path);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
                >
                  <span className={cn('h-[7px] w-[7px] rounded-full', view.start || state !== 'stopped' ? stateDotClass(state) : 'border border-[var(--theme-text-muted)]')} />
                  <span className="flex-1 truncate text-[var(--theme-text-primary)]">{label}</span>
                  <span className="text-[10px] text-[var(--theme-text-muted)]">{STATE_LABEL[state]}</span>
                </button>
              );
            })}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
