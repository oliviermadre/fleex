import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorktreeActionItem, WorktreeActionsView, WorktreeServerSnapshot, WorktreeVerb } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { usePopover } from '../../hooks/usePopover';
import { openWorktreeUrl, useWorktreeActionsStore } from '../../stores/worktreeActionsStore';
import { Tooltip } from '../ui/Tooltip';
import { OverlaySyncModal } from '../overlay-sync/OverlaySyncModal';
import { WorktreeActionMenu } from './WorktreeActionMenu';
import { STATE_LABEL, resolveLeftClick, stateDotClass, stateTextClass } from './worktreeUi';

/** First line of the tooltip: the URL of a running server, else its state. */
export function stateLine(server: WorktreeServerSnapshot, configured: boolean): string {
  if (!configured) return 'start non configuré';
  if (server.state === 'running') {
    const primary = server.endpoints?.[0];
    if (primary && server.endpoints!.length > 1) return `${primary.name} ${primary.url}`;
    return server.url ?? (server.port ? `localhost:${server.port}` : 'running (port inconnu)');
  }
  if (server.state === 'error') return server.exitCode !== undefined ? `error (exit ${server.exitCode})` : 'error';
  return server.state === 'starting' ? 'starting…' : STATE_LABEL[server.state];
}

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
  /** Bumped to open the menu from outside (a pick in the `+N` overflow list). */
  openNonce?: number;
}

/**
 * A worktree's button in two parts (PRD §8.1): the left part runs what the
 * server's state calls for (Start when stopped, Open when running, Logs on
 * error…), the ▾ part opens the launcher. Right click and long press anywhere
 * on it open the launcher too, so a phone or a trackpad never needs a right click.
 */
export function WorktreeActionButton({ view, root, ticketId, label, openNonce }: Props) {
  const server = useWorktreeActionsStore((s) => s.servers[view.path]) ?? view.server;
  const load = useWorktreeActionsStore((s) => s.load);
  const runVerb = useWorktreeActionsStore((s) => s.runVerb);
  const runItem = useWorktreeActionsStore((s) => s.runItem);
  const setPinned = useWorktreeActionsStore((s) => s.setPinned);
  const setup = useWorktreeActionsStore((s) => s.setups[view.path]) ?? view.setup;
  const rerunSetup = useWorktreeActionsStore((s) => s.rerunSetup);
  const showSetupLogs = useWorktreeActionsStore((s) => s.showSetupLogs);
  const openHooksDir = useWorktreeActionsStore((s) => s.openHooksDir);
  const navigate = useNavigate();
  const [syncOpen, setSyncOpen] = useState(false);
  const { open, setOpen, refs, floatingStyles, getFloatingProps } = usePopover({ placement: 'bottom-end', maxHeight: MENU_MAX_HEIGHT, enableClick: false });

  const openMenu = useCallback(() => {
    // Detected commands are re-read when the menu opens (the files may have changed).
    void load(root);
    setOpen(true);
  }, [load, root, setOpen]);

  useEffect(() => {
    if (openNonce) openMenu();
    // Only a new nonce opens it, not a re-render (openMenu is stable enough to leave out).
  }, [openNonce]);

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
  const [org, repoName] = view.repo?.split('/') ?? [];
  const settingsUrl = org && repoName ? `/repositories/${org}/${repoName}?tab=config` : null;
  // Nothing to start: the left click goes where the start is configured (PRD §6).
  const left = !view.start && state === 'stopped' && settingsUrl
    ? { kind: 'settings' as const, label: 'Configurer le start (Réglages › Actions et Hooks)' }
    : resolveLeftClick(view, state);

  /** The click a browser still sends after a long press (iOS Safari) must not act again. */
  const swallowLongPressClick = () => {
    if (!longPressed.current) return false;
    longPressed.current = false;
    return true;
  };

  const onLeft = () => {
    if (swallowLongPressClick()) return;
    if (left.kind === 'settings') navigate(settingsUrl!);
    else if (left.kind === 'menu') openMenu();
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
        <Tooltip
          label={
            <span data-testid="worktree-tooltip" className="flex flex-col gap-0.5 whitespace-nowrap">
              {/* First thing asked of a running server: where is it? */}
              <span className={cn('font-mono', configured && stateTextClass(state))}>{stateLine(server, configured)}</span>
              {/* Every service the probe reported, the primary one being the line above. */}
              {state === 'running' && server.endpoints?.slice(1).map((e) => (
                <span key={e.name} className="font-mono text-[var(--theme-text-muted)]">{e.name} {e.url}</span>
              ))}
              <span>▶ Clic : {left.label}</span>
              <span className="text-[var(--theme-text-muted)]">Clic droit / ▾ : menu</span>
            </span>
          }
        >
          <button
            type="button"
            onClick={onLeft}
            aria-label={`${label} — ${configured ? STATE_LABEL[state] : 'not configured'}`}
            className="flex items-center gap-1.5 px-2 hover:bg-[var(--theme-accent-muted)] hover:text-[var(--theme-text-primary)]"
          >
            {/* Compact: the name, then the state as a dot only (state, port and URL are in the tooltip). */}
            <span className="max-w-[140px] truncate text-[var(--theme-text-primary)]">{label}</span>
            <span
              data-testid="worktree-state-dot"
              className={cn('h-[7px] w-[7px] shrink-0 rounded-full', configured ? stateDotClass(state) : 'border border-[var(--theme-text-muted)]')}
            />
            {setup?.state === 'failed' && <span className={stateTextClass('error')} title="Le Setup a échoué — voir le menu">⚠</span>}
            {setup?.state === 'running' && <span className={cn('animate-pulse motion-reduce:animate-none', stateTextClass('starting'))} title="Setup en cours">◌</span>}
          </button>
        </Tooltip>
        <span className="w-px bg-[var(--theme-border)]" />
        <button
          type="button"
          aria-label={`${label} menu`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            if (swallowLongPressClick()) return; // the long press already opened it
            if (open) setOpen(false);
            else openMenu();
          }}
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
          onOpenUrl={(url) => openWorktreeUrl(url, ticketId)}
          onItem={(item: WorktreeActionItem) => void runItem(view, item)}
          onPin={(item, pinned) => void setPinned(root, view, item.id, pinned)}
          onSyncOverlay={() => setSyncOpen(true)}
          onRepoSettings={settingsUrl ? () => navigate(settingsUrl) : null}
          {...(setup ? { setup } : {})}
          onRerunSetup={() => void rerunSetup(view)}
          onSetupLogs={() => showSetupLogs(view)}
          onOpenHooks={view.repo ? () => void openHooksDir(view.repo!) : null}
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
