import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { diagnoseRun, type ActionRun, type PinnedIcon, type WorkspaceAction } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { useTerminal } from '../../hooks/useTerminal';
import { terminalManager } from '../../services/terminalManager';
import { DRAFT_SOURCE_PREFIX, usePinnedActionsStore, type TerminalTab } from '../../stores/pinnedActionsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { renderIcon } from '../sidebar/PinnedIcons';
import { RunningBadge } from './ActionLogsModal';
import { RunHintCard } from './RunHintCard';
import { runDuration, statusTextClass } from './actionStatus';
import { anchoredBox, terminalAnchorRect, titleBarBottom, type PanelBox } from './terminalAnchor';

/** A terminal run that exits 0 closes its tab after this, when its action asks for it. */
export const TERMINAL_AUTO_CLOSE_MS = 2000;

/** The xterm session id the server resolves to the run's tmux session. */
export function actionTerminalSessionId(runId: string): string {
  return `action:${runId}`;
}

/** "0:14", "12:03" — the panel's running clock. */
function clock(startedAt: string, now: number): string {
  const sec = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function homeRelative(path: string): string {
  return path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~');
}

function useTabRun(tab: TerminalTab): ActionRun | undefined {
  return usePinnedActionsStore((s) => s.runs[tab.sourceId]?.find((r) => r.runId === tab.runId));
}

function useSourceAction(sourceId: string): PinnedIcon | WorkspaceAction | undefined {
  const id = sourceId.startsWith(DRAFT_SOURCE_PREFIX) ? sourceId.slice(DRAFT_SOURCE_PREFIX.length) : sourceId;
  return useSettingsStore((s) => s.settings.pinnedIcons.find((a) => a.id === id) ?? (s.settings.workspaceActions ?? []).find((a) => a.id === id));
}

/** Remove a tab and its xterm instance (the server pane is released by the store). */
function closeTab(tab: TerminalTab): void {
  usePinnedActionsStore.getState().closeTerminal(tab.sourceId);
  terminalManager.dispose(actionTerminalSessionId(tab.runId));
}

/**
 * The floating "Action terminal": where terminal-mode actions run, in an
 * interactive zsh the user can type into. One tab per source; Escape belongs
 * to the terminal (never intercepted), ⌘W closes the tab when the panel has focus.
 */
export function ActionTerminalPanel() {
  const terminals = usePinnedActionsStore((s) => s.terminals);
  const active = usePinnedActionsStore((s) => s.activeTerminal);
  const focusNonce = usePinnedActionsStore((s) => s.terminalFocusNonce);
  const minimized = usePinnedActionsStore((s) => s.terminalMinimized);
  const [fullScreen, setFullScreen] = useState(false);
  const [confirm, setConfirm] = useState<{ tab: TerminalTab; close: boolean } | null>(null);

  if (terminals.length === 0) return null;
  const tab = terminals.find((t) => t.sourceId === active) ?? terminals[terminals.length - 1]!;

  return createPortal(
    <>
      {terminals.map((t) => <AutoClose key={t.runId} tab={t} />)}
      {!minimized && (
      <ActiveTab
        tab={tab}
        tabs={terminals}
        focusNonce={focusNonce}
        fullScreen={fullScreen}
        onToggleFullScreen={() => setFullScreen((f) => !f)}
        onRequestStop={(t, close) => setConfirm({ tab: t, close })}
      />
      )}
      <ConfirmModal
        open={!!confirm}
        title={`Stop ${confirm?.tab.label ?? ''}?`}
        message="The command is still running in the terminal. Stopping it ends the session."
        confirmLabel="Stop"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          void usePinnedActionsStore.getState().cancelRun(confirm.tab.runId);
          if (confirm.close) closeTab(confirm.tab);
          setConfirm(null);
        }}
      />
    </>,
    document.body,
  );
}

/** Closes a tab 2 s after exit 0 when its action asks for it — never on a failure or a stop. */
function AutoClose({ tab }: { tab: TerminalTab }) {
  const run = useTabRun(tab);
  const success = !!run?.finishedAt && run.exitCode === 0 && !run.cancelled && !run.timedOut;
  useEffect(() => {
    if (!tab.closeOnSuccess || !success) return;
    const timer = setTimeout(() => closeTab(tab), TERMINAL_AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [tab, success]);
  return null;
}

/**
 * Under the button that opened it, like the top bar's other popovers; in the
 * bottom-right corner when there is no button to hang from or no room under it.
 * Re-measured when a tab is brought to front and on window resize.
 */
function usePanelBox(sourceId: string, focusNonce: number): PanelBox {
  const [box, setBox] = useState<PanelBox>(null);
  useLayoutEffect(() => {
    const update = () => {
      const rect = terminalAnchorRect();
      setBox(rect ? anchoredBox(rect, { width: window.innerWidth, height: window.innerHeight }) : null);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [sourceId, focusNonce]);
  return box;
}

/** Full screen stops below the desktop title bar, which is drawn over the page and swallows clicks. */
function fullScreenStyle(): CSSProperties {
  return { top: titleBarBottom() + 16, left: 16, right: 16, bottom: 16 };
}

function ActiveTab({
  tab,
  tabs,
  focusNonce,
  fullScreen,
  onToggleFullScreen,
  onRequestStop,
}: {
  tab: TerminalTab;
  tabs: TerminalTab[];
  focusNonce: number;
  fullScreen: boolean;
  onToggleFullScreen: () => void;
  onRequestStop: (tab: TerminalTab, close: boolean) => void;
}) {
  const run = useTabRun(tab);
  const action = useSourceAction(tab.sourceId);
  const running = !run?.finishedAt;
  const { focusTerminal, openLogs, minimizeTerminal } = usePinnedActionsStore.getState();
  const box = usePanelBox(tab.sourceId, focusNonce);

  const requestClose = () => (running ? onRequestStop(tab, true) : closeTab(tab));

  return (
    <div
      data-floating-panel
      role="dialog"
      aria-label={`Action terminal — ${tab.label}`}
      data-placement={fullScreen ? 'full-screen' : box ? 'anchored' : 'corner'}
      className={cn(
        'action-terminal-panel fixed z-40 flex flex-col overflow-hidden rounded-xl',
        box && !fullScreen && 'action-terminal-panel--anchored',
        !fullScreen && !box && 'bottom-4 right-4 h-[360px] w-[640px] max-w-[calc(100vw-2rem)]',
      )}
      style={fullScreen ? fullScreenStyle() : box ?? undefined}
      onKeyDownCapture={(e) => {
        // ⌘W closes the tab; Escape and everything else go to the terminal.
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
          e.preventDefault();
          e.stopPropagation();
          requestClose();
        }
      }}
    >
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Action terminals" className="flex shrink-0 gap-0.5 border-b border-[var(--theme-border-subtle)] px-2 pt-1.5">
          {tabs.map((t) => (
            <TabButton key={t.sourceId} tab={t} active={t.sourceId === tab.sourceId} onSelect={() => focusTerminal(t.sourceId)} />
          ))}
        </div>
      )}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--theme-border-subtle)] bg-[var(--theme-bg-hover)] px-3 text-xs">
        {action?.icon && <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[var(--theme-text-primary)]">{renderIcon(action, 14)}</span>}
        <span className="shrink-0 font-semibold text-[var(--theme-text-primary)]">{tab.label}</span>
        <span className="text-[var(--theme-text-faint)]">—</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--theme-text-muted)]" title={tab.command}>{tab.command}</code>
        {running && run && <RunningBadge startedAt={run.startedAt} format={clock} />}
        <Button variant="ghost" size="sm" className="px-1.5 py-0" aria-label="Minimize" title="Minimize — the session keeps running; click the action to bring it back" onClick={minimizeTerminal}>–</Button>
        <Button variant="ghost" size="sm" className="px-1.5 py-0" aria-label={fullScreen ? 'Exit full screen' : 'Full screen'} title={fullScreen ? 'Exit full screen' : 'Full screen'} onClick={onToggleFullScreen}>⤢</Button>
        {running && <Button variant="ghost" size="sm" className="px-2 py-0" onClick={() => onRequestStop(tab, false)}>Stop</Button>}
        <Button variant="ghost" size="sm" className="px-1.5 py-0" aria-label="Close terminal" title="Close (⌘W) — ends the session" onClick={requestClose}>×</Button>
      </div>
      <TerminalView key={tab.runId} sessionId={actionTerminalSessionId(tab.runId)} focusNonce={focusNonce} />
      {running ? (
        <div className="shrink-0 border-t border-[var(--theme-border-subtle)] px-3 py-1.5 font-mono text-[10.5px] text-[var(--theme-text-muted)]">
          zsh -l -i · cwd {tab.cwd ? homeRelative(tab.cwd) : '~'} · stdout+stderr mixed
        </div>
      ) : (
        <FinishedFooter tab={tab} run={run!} onClose={() => closeTab(tab)} onViewLogs={() => openLogs({ sourceId: tab.sourceId, label: tab.label, runId: tab.runId })} />
      )}
    </div>
  );
}

function TabButton({ tab, active, onSelect }: { tab: TerminalTab; active: boolean; onSelect: () => void }) {
  const run = useTabRun(tab);
  const ok = run?.finishedAt ? run.exitCode === 0 && !run.cancelled : null;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        'flex max-w-[180px] items-center gap-1.5 rounded-t-md px-2.5 py-1 text-[11px]',
        active ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]',
      )}
    >
      <span className={ok === null ? 'animate-pulse text-[var(--theme-accent)] motion-reduce:animate-none' : statusTextClass(ok ? 'ok' : 'ko')}>{ok === null ? '●' : ok ? '✓' : '✗'}</span>
      <span className="truncate">{tab.label}</span>
    </button>
  );
}

function FinishedFooter({ tab, run, onClose, onViewLogs }: { tab: TerminalTab; run: ActionRun; onClose: () => void; onViewLogs: () => void }) {
  const ok = run.exitCode === 0 && !run.cancelled && !run.timedOut;
  const hint = diagnoseRun({ ...run, mode: 'terminal' });
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-[var(--theme-border-subtle)] px-3 py-1.5 text-[11px]">
      <div className="flex items-center gap-2">
        <span className={cn('font-mono', statusTextClass(ok ? 'ok' : run.cancelled ? 'unknown' : 'ko'))} role="status">
          {run.cancelled ? '■ stopped' : ok ? '✓ exit 0' : run.timedOut ? '✗ timed out' : `✗ exit ${run.exitCode ?? '—'}`} · {runDuration(run.startedAt, run.finishedAt)}
        </span>
        {ok && tab.closeOnSuccess && <span className="text-[var(--theme-text-muted)]">closing…</span>}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" className="px-2 py-0" onClick={onViewLogs}>View logs</Button>
        <Button variant="secondary" size="sm" className="px-2 py-0" onClick={onClose}>Close</Button>
      </div>
      {hint && hint.code !== 'cancelled' && <RunHintCard hint={hint} />}
    </div>
  );
}

/** The xterm attached to the run's tmux session; grabs the keyboard when its tab is opened or brought to front. */
function TerminalView({ sessionId, focusNonce }: { sessionId: string; focusNonce: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useTerminal(sessionId, ref);

  useEffect(() => {
    terminalManager.setFloatingMode(sessionId, true);
  }, [sessionId]);

  useEffect(() => {
    const timer = setTimeout(() => terminalManager.get(sessionId)?.terminal.focus(), 50);
    return () => clearTimeout(timer);
  }, [sessionId, focusNonce]);

  return <div ref={ref} className="xterm-container min-h-0 flex-1" data-testid="action-terminal" />;
}
