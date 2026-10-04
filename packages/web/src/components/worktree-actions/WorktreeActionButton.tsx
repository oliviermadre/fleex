import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorktreeActionItem, WorktreeActionsView, WorktreeVerb } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { usePopover } from '../../hooks/usePopover';
import { useWorktreeActionsStore } from '../../stores/worktreeActionsStore';
import { Tooltip } from '../ui/Tooltip';
import { OverlaySyncModal } from '../overlay-sync/OverlaySyncModal';
import { WorktreeActionMenu } from './WorktreeActionMenu';
import { STATE_LABEL, resolveLeftClick, stateDotClass, stateTextClass } from './worktreeUi';

/** PRD §8.2: the menu never grows past this, it scrolls inside. */
export const MENU_MAX_HEIGHT = 440;
const LONG_PRESS_MS = 500;

interface Props {
  view: WorktreeActionsView;
  /** The ticket workspace this button was listed from (menus refresh it). */
  root: string;
  ticketId: string | null;
  /** Short name shown on the button (`fleex`, or `fleex·spike` when a repo has two worktrees). */
  label: string;
}

/**
 * A worktree's button in two parts (PRD §8.1): the left part runs what the
 * server's state calls for (Start when stopped, Open when running, Logs on
 * error…), the ▾ part opens the launcher. Right click and long press anywhere
 * on it open the launcher too, so a phone or a trackpad never needs a right click.
 */
export function WorktreeActionButton({ view, root, ticketId, label }: Props) {
  const server = useWorktreeActionsStore((s) => s.servers[view.path]) ?? view.server;
  const load = useWorktreeActionsStore((s) => s.load);
  const runVerb = useWorktreeActionsStore((s) => s.runVerb);
  const runItem = useWorktreeActionsStore((s) => s.runItem);
  const setPinned = useWorktreeActionsStore((s) => s.setPinned);
  const navigate = useNavigate();
  const [syncOpen, setSyncOpen] = useState(false);
  const { open, setOpen, refs, floatingStyles, getFloatingProps } = usePopover({ placement: 'bottom-end', maxHeight: MENU_MAX_HEIGHT, enableClick: false });

  const openMenu = useCallback(() => {
    // Detected commands are re-read when the menu opens (the files may have changed).
    void load(root);
    setOpen(true);
  }, [load, root, setOpen]);

  // Long press (touch): open the menu, and swallow the click that follows.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const touchHandlers = {
    onTouchStart: () => {
      longPressed.current = false;
      cancelPress();
      pressTimer.current = setTimeout(() => {
        longPressed.current = true;
        openMenu();
      }, LONG_PRESS_MS);
    },
    onTouchEnd: cancelPress,
    onTouchMove: cancelPress,
    onTouchCancel: cancelPress,
  };

  const state = server.state;
  const configured = !!view.start || state !== 'stopped';
  const left = resolveLeftClick(view, state);
  const [org, repoName] = view.repo?.split('/') ?? [];

  const onLeft = () => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (left.kind === 'menu') openMenu();
    else if (left.kind === 'verb') void runVerb(view, left.verb as WorktreeVerb, ticketId);
    else void runItem(view, left.item);
  };

  return (
    <>
      <div
        ref={refs.setReference}
        data-testid="worktree-action-button"
        data-state={state}
        className={cn(
          'flex h-6 shrink-0 items-stretch overflow-hidden rounded border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] text-[11px] font-medium text-[var(--theme-text-secondary)] transition-colors hover:border-[var(--theme-accent)]',
          open && 'border-[var(--theme-accent)]',
        )}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu();
        }}
        {...touchHandlers}
      >
        <Tooltip label={<span className="whitespace-nowrap">▶ Click: {left.label} · right click / ▾: menu</span>}>
          <button
            type="button"
            onClick={onLeft}
            aria-label={`${label} — ${configured ? STATE_LABEL[state] : 'not configured'}`}
            className="flex items-center gap-1.5 px-2 hover:bg-[var(--theme-accent-muted)] hover:text-[var(--theme-text-primary)]"
          >
            <span
              data-testid="worktree-state-dot"
              className={cn('h-[7px] w-[7px] shrink-0 rounded-full', configured ? stateDotClass(state) : 'border border-[var(--theme-text-muted)]')}
            />
            <span className="max-w-[140px] truncate text-[var(--theme-text-primary)]">{label}</span>
            {state === 'running' && server.port ? (
              <span className={cn('font-mono text-[10.5px]', stateTextClass('running'))}>:{server.port}</span>
            ) : (
              <span className={cn('text-[10px]', configured ? stateTextClass(state) : 'text-[var(--theme-text-faint)]')}>{STATE_LABEL[state]}</span>
            )}
          </button>
        </Tooltip>
        <span className="w-px bg-[var(--theme-border)]" />
        <button
          type="button"
          aria-label={`${label} menu`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : openMenu())}
          className="flex w-[22px] items-center justify-center text-[var(--theme-text-muted)] hover:bg-[var(--theme-accent-muted)] hover:text-[var(--theme-text-primary)]"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="4,6 8,10 12,6" />
          </svg>
        </button>
      </div>
      {open && (
        <WorktreeActionMenu
          view={view}
          server={server}
          name={label}
          onVerb={(verb) => void runVerb(view, verb, ticketId)}
          onItem={(item: WorktreeActionItem) => void runItem(view, item)}
          onPin={(item, pinned) => void setPinned(root, view, item.id, pinned)}
          onSyncOverlay={() => setSyncOpen(true)}
          onRepoSettings={org && repoName ? () => navigate(`/repositories/${org}/${repoName}?tab=config`) : null}
          onClose={() => setOpen(false)}
          floatingRef={refs.setFloating}
          floatingStyles={floatingStyles}
          floatingProps={getFloatingProps()}
        />
      )}
      {/* Sync overlay, limited to this worktree (a repo checkout is scanned on its own). */}
      <OverlaySyncModal open={syncOpen} onClose={() => setSyncOpen(false)} rootPath={view.path} />
    </>
  );
}
