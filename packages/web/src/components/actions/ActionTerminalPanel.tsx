import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { diagnoseRun, type ActionRun, type PinnedIcon, type WorkspaceAction } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tint, tintText } from '../../lib/tints';
import { useFloatingResize, type ResizeDirection } from '../../hooks/useFloatingResize';
import { useTerminal } from '../../hooks/useTerminal';
import { terminalManager } from '../../services/terminalManager';
import { DRAFT_SOURCE_PREFIX, usePinnedActionsStore, type TerminalTab } from '../../stores/pinnedActionsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button } from '../ui/Button';
import { renderIcon } from '../sidebar/PinnedIcons';
import { RunningBadge } from './ActionLogsModal';
import { RunHintCard } from './RunHintCard';
import { runDuration, statusTextClass } from './actionStatus';
import { PANEL_HEIGHT, PANEL_WIDTH, anchoredBox, terminalAnchorRect, titleBarBottom } from './terminalAnchor';

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

  if (terminals.length === 0) return null;
  const tab = terminals.find((t) => t.sourceId === active) ?? terminals[terminals.length - 1]!;

  return createPortal(
    <>
      {terminals.map((t) => <AutoClose key={t.runId} tab={t} />)}
      {!minimized && (
        <ActiveTab tab={tab} tabs={terminals} focusNonce={focusNonce} fullScreen={fullScreen} onToggleFullScreen={() => setFullScreen((f) => !f)} />
      )}
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

export const PANEL_MIN_WIDTH = 420;
export const PANEL_MIN_HEIGHT = 220;
const CORNER_MARGIN = 16;

/** Under the button that opened it (like the bar's popovers), else the bottom-right corner. */
function initialBox(): { x: number; y: number; width: number; height: number } {
  const rect = terminalAnchorRect();
  const box = rect ? anchoredBox(rect, { width: window.innerWidth, height: window.innerHeight }) : null;
  if (box) return { x: box.left, y: box.top, width: box.width, height: box.height };
  const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * CORNER_MARGIN);
  const height = PANEL_HEIGHT;
  return { x: window.innerWidth - width - CORNER_MARGIN, y: window.innerHeight - height - CORNER_MARGIN, width, height };
}

/** Full screen stops below the desktop title bar, which is drawn over the page and swallows clicks. */
function fullScreenStyle(): CSSProperties {
  return { top: titleBarBottom() + 16, left: 16, right: 16, bottom: 16 };
}

/**
 * Two clicks to kill: the first arms the button ("Confirm"), the second ends the
 * session. No modal over the terminal; disarms by itself if not confirmed.
 */
export const KILL_CONFIRM_MS = 3000;
function KillButton({ onKill }: { onKill: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), KILL_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('px-2 py-0', armed && cn(tint('red'), tintText('red')))}
      title={armed ? 'Click again to end the session' : 'Kill — ends the tmux session and closes the terminal'}
      onClick={() => (armed ? onKill() : setArmed(true))}
      onBlur={() => setArmed(false)}
    >
      {armed ? 'Confirm' : 'Kill'}
    </Button>
  );
}

function ActiveTab({
  tab,
  tabs,
  focusNonce,
  fullScreen,
  onToggleFullScreen,
}: {
  tab: TerminalTab;
  tabs: TerminalTab[];
  focusNonce: number;
  fullScreen: boolean;
  onToggleFullScreen: () => void;
}) {
  const run = useTabRun(tab);
  const action = useSourceAction(tab.sourceId);
  const running = !run?.finishedAt;
  const { focusTerminal, openLogs, minimizeTerminal, setTerminalGeometry, refresh } = usePinnedActionsStore.getState();

  // The user's size and place survive Minimize and tab switches; until they resize, the panel follows its button.
  const saved = usePinnedActionsStore((s) => s.terminalGeometry);
  const [start] = useState(() => saved ?? initialBox());
  const { size, setSize, effectivePos, setPosition, handleResizeMouseDown } = useFloatingResize({
    minWidth: PANEL_MIN_WIDTH,
    minHeight: PANEL_MIN_HEIGHT,
    defaultWidth: start.width,
    defaultHeight: start.height,
    initialPosition: { x: start.x, y: start.y },
  });
  const geometry = useRef({ x: start.x, y: start.y, width: start.width, height: start.height });
  geometry.current = { ...effectivePos, ...size };
  const firstFocus = useRef(focusNonce);
  useEffect(() => {
    if (focusNonce === firstFocus.current || usePinnedActionsStore.getState().terminalGeometry) return;
    const next = initialBox();
    setSize({ width: next.width, height: next.height });
    setPosition({ x: next.x, y: next.y });
  }, [focusNonce, setPosition, setSize]);
  const onResizeStart = (dir: ResizeDirection) => (e: React.MouseEvent) => {
    handleResizeMouseDown(dir)(e);
    const remember = () => {
      window.removeEventListener('mouseup', remember);
      // After the hook's own mouseup has applied the last size.
      setTimeout(() => setTerminalGeometry({ ...geometry.current }), 0);
    };
    window.addEventListener('mouseup', remember);
  };

  /** Kill: the session ends (running or not), the tab goes away and the action's state is re-read. */
  const kill = () => {
    closeTab(tab);
    const probed = !!action && 'status' in action && !!action.status;
    if (tab.sourceKind === 'pinned' && probed && !tab.sourceId.startsWith(DRAFT_SOURCE_PREFIX)) void refresh(tab.sourceId);
  };

  const boxStyle: CSSProperties = fullScreen
    ? fullScreenStyle()
    : { left: effectivePos.x, top: effectivePos.y, width: size.width, height: size.height };

  return (
    <>
      <div
        data-floating-panel
        role="dialog"
        aria-label={`Action terminal — ${tab.label}`}
        data-placement={fullScreen ? 'full-screen' : 'floating'}
        className={cn('action-terminal-panel fixed z-40 flex flex-col overflow-hidden rounded-xl', !fullScreen && 'action-terminal-panel--anchored')}
        style={boxStyle}
        onKeyDownCapture={(e) => {
          // ⌘W minimizes, like ×; Escape and everything else go to the terminal.
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
            e.preventDefault();
            e.stopPropagation();
            minimizeTerminal();
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
          <Button variant="ghost" size="sm" className="px-1.5 py-0" aria-label={fullScreen ? 'Exit full screen' : 'Full screen'} title={fullScreen ? 'Exit full screen' : 'Full screen'} onClick={onToggleFullScreen}>⤢</Button>
          <KillButton key={tab.runId} onKill={kill} />
          <Button variant="ghost" size="sm" className="px-1.5 py-0" aria-label="Minimize" title="Minimize (⌘W) — the session keeps running; click the action to bring it back" onClick={minimizeTerminal}>×</Button>
        </div>
        <TerminalView key={tab.runId} sessionId={actionTerminalSessionId(tab.runId)} focusNonce={focusNonce} />
        {running ? (
          <div className="shrink-0 border-t border-[var(--theme-border-subtle)] px-3 py-1.5 font-mono text-[10.5px] text-[var(--theme-text-muted)]">
            zsh -l -i · cwd {tab.cwd ? homeRelative(tab.cwd) : '~'} · stdout+stderr mixed
          </div>
        ) : (
          <FinishedFooter tab={tab} run={run!} onViewLogs={() => openLogs({ sourceId: tab.sourceId, label: tab.label, runId: tab.runId })} />
        )}
      </div>
      {!fullScreen && <ResizeHandles x={effectivePos.x} y={effectivePos.y} width={size.width} height={size.height} onStart={onResizeStart} />}
    </>
  );
}

/** Edge and corner grips, the same as Fleex's other floating panels. */
function ResizeHandles({ x, y, width, height, onStart }: { x: number; y: number; width: number; height: number; onStart: (dir: ResizeDirection) => (e: React.MouseEvent) => void }) {
  const grip = (dir: ResizeDirection, style: CSSProperties) => (
    <div key={dir} data-resize={dir} className="fixed z-40" style={{ ...style, cursor: `${dir}-resize` }} onMouseDown={onStart(dir)} />
  );
  return (
    <>
      {grip('n', { top: y - 3, left: x + 8, width: width - 16, height: 6 })}
      {grip('s', { top: y + height - 3, left: x + 8, width: width - 16, height: 6 })}
      {grip('w', { top: y + 8, left: x - 3, width: 6, height: height - 16 })}
      {grip('e', { top: y + 8, left: x + width - 3, width: 6, height: height - 16 })}
      {grip('nw', { top: y - 4, left: x - 4, width: 12, height: 12 })}
      {grip('ne', { top: y - 4, left: x + width - 8, width: 12, height: 12 })}
      {grip('sw', { top: y + height - 8, left: x - 4, width: 12, height: 12 })}
      {grip('se', { top: y + height - 8, left: x + width - 8, width: 12, height: 12 })}
    </>
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

function FinishedFooter({ tab, run, onViewLogs }: { tab: TerminalTab; run: ActionRun; onViewLogs: () => void }) {
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
