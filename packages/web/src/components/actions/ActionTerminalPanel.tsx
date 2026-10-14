import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { diagnoseRun, type ActionRun, type PinnedIcon, type WorkspaceAction } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { clampPosition, useFloatingResize, type ResizeDirection } from '../../hooks/useFloatingResize';
import { useTerminal } from '../../hooks/useTerminal';
import { terminalManager } from '../../services/terminalManager';
import { DRAFT_SOURCE_PREFIX, usePinnedActionsStore, type TerminalGeometry, type TerminalTab } from '../../stores/pinnedActionsStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { renderIcon } from '../sidebar/PinnedIcons';
import { RunningBadge } from './ActionLogsModal';
import { RunHintCard } from './RunHintCard';
import { runDuration, statusTextClass } from './actionStatus';
import { titleBarBottom } from './terminalAnchor';

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
  usePinnedActionsStore.getState().closeTerminal(tab.key);
  terminalManager.dispose(actionTerminalSessionId(tab.runId));
}

/** Kill: the session ends (running or not), the tab goes away and the action's state is re-read. */
function killTab(tab: TerminalTab, action: PinnedIcon | WorkspaceAction | undefined): void {
  closeTab(tab);
  const probed = !!action && 'status' in action && !!action.status;
  if (tab.sourceKind === 'pinned' && probed && !tab.sourceId.startsWith(DRAFT_SOURCE_PREFIX)) void usePinnedActionsStore.getState().refresh(tab.sourceId);
}

/**
 * The floating "Action terminal": where terminal-mode actions run, in an
 * interactive zsh the user can type into. One tab per action command.
 *
 * Two different "close": the window's × (and ⌘W) only HIDES the panel — every
 * terminal keeps running; a tab's × KILLS that terminal. Escape belongs to the
 * terminal (never intercepted).
 */
export function ActionTerminalPanel() {
  const terminals = usePinnedActionsStore((s) => s.terminals);
  const active = usePinnedActionsStore((s) => s.activeTerminal);
  const focusNonce = usePinnedActionsStore((s) => s.terminalFocusNonce);
  const minimized = usePinnedActionsStore((s) => s.terminalMinimized);
  const [maximized, setMaximized] = useState(false);

  if (terminals.length === 0) return null;
  const tab = terminals.find((t) => t.key === active) ?? terminals[terminals.length - 1]!;

  return createPortal(
    <>
      {terminals.map((t) => <AutoClose key={t.runId} tab={t} />)}
      {!minimized && (
        <ActiveTab tab={tab} tabs={terminals} focusNonce={focusNonce} maximized={maximized} onToggleMaximized={() => setMaximized((m) => !m)} />
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
/** Opened for the first time: centred, this share of the window. */
export const DEFAULT_PANEL_RATIO = 0.66;
const MAXIMIZED_MARGIN = 16;

/** The area the panel may use: the viewport below the desktop title bar (drawn over the page, it swallows clicks). */
function usableArea(): { top: number; width: number; height: number } {
  const top = titleBarBottom();
  return { top, width: window.innerWidth, height: window.innerHeight - top };
}

/** The last place and size the user gave the panel, made to fit today's window; else centred, 66 % × 66 %. */
export function initialGeometry(saved: TerminalGeometry | null): TerminalGeometry {
  const area = usableArea();
  if (saved) {
    const width = Math.min(Math.max(saved.width, PANEL_MIN_WIDTH), area.width);
    const height = Math.min(Math.max(saved.height, PANEL_MIN_HEIGHT), area.height);
    return { ...clampPosition(saved.x, saved.y, width, height, area.top), width, height };
  }
  const width = Math.max(PANEL_MIN_WIDTH, Math.round(area.width * DEFAULT_PANEL_RATIO));
  const height = Math.max(PANEL_MIN_HEIGHT, Math.round(area.height * DEFAULT_PANEL_RATIO));
  return { ...clampPosition(Math.round((area.width - width) / 2), Math.round(area.top + (area.height - height) / 2), width, height, area.top), width, height };
}

function maximizedStyle(): CSSProperties {
  return { top: titleBarBottom() + MAXIMIZED_MARGIN, left: MAXIMIZED_MARGIN, right: MAXIMIZED_MARGIN, bottom: MAXIMIZED_MARGIN };
}

const WINDOW_ICONS = {
  maximize: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  restore: <path d="M5 12h14" />,
  hide: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
} as const;

/** One of the panel's window controls: a small square button, its icon, a tooltip. */
function WindowButton({ kind, label, onClick }: { kind: keyof typeof WINDOW_ICONS; label: string; onClick: () => void }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        data-window-button={kind}
        onClick={onClick}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {WINDOW_ICONS[kind]}
        </svg>
      </button>
    </Tooltip>
  );
}

/** A press on a button of the bar is a click, not the start of a drag or a double-click. */
function onAButton(e: React.MouseEvent): boolean {
  return !!(e.target as HTMLElement).closest('button');
}

function ActiveTab({
  tab,
  tabs,
  focusNonce,
  maximized,
  onToggleMaximized,
}: {
  tab: TerminalTab;
  tabs: TerminalTab[];
  focusNonce: number;
  maximized: boolean;
  onToggleMaximized: () => void;
}) {
  const run = useTabRun(tab);
  const action = useSourceAction(tab.sourceId);
  const running = !run?.finishedAt;
  const { focusTerminal, openLogs, minimizeTerminal: hide, setTerminalGeometry } = usePinnedActionsStore.getState();

  // Opens where the user last left it (moved or resized, even in an earlier session), else in the middle.
  const [start] = useState(() => initialGeometry(usePinnedActionsStore.getState().terminalGeometry));
  const top = titleBarBottom();
  const { size, effectivePos, setPosition, handleResizeMouseDown } = useFloatingResize({
    minWidth: PANEL_MIN_WIDTH,
    minHeight: PANEL_MIN_HEIGHT,
    defaultWidth: start.width,
    defaultHeight: start.height,
    initialPosition: { x: start.x, y: start.y },
    minY: top,
  });
  const { x, y } = effectivePos;
  const { width, height } = size;
  useEffect(() => {
    setTerminalGeometry({ x, y, width, height });
  }, [x, y, width, height, setTerminalGeometry]);

  // No size/position animation while the user drags or resizes: the panel follows the mouse.
  const [moving, setMoving] = useState(false);
  const track = () => {
    setMoving(true);
    const done = () => {
      window.removeEventListener('mouseup', done);
      setMoving(false);
    };
    window.addEventListener('mouseup', done);
  };
  const onResizeStart = (dir: ResizeDirection) => (e: React.MouseEvent) => {
    track();
    handleResizeMouseDown(dir)(e);
  };
  const drag = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const onBarMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || maximized || onAButton(e)) return;
    e.preventDefault();
    drag.current = { x: e.clientX, y: e.clientY, posX: x, posY: y };
    track();
    const move = (me: MouseEvent) => {
      const d = drag.current;
      setPosition(clampPosition(d.posX + me.clientX - d.x, d.posY + me.clientY - d.y, width, height, titleBarBottom()));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const boxStyle: CSSProperties = maximized ? maximizedStyle() : { left: x, top: y, width, height };

  return (
    <>
      <div
        data-floating-panel
        role="dialog"
        aria-label={`Action terminal — ${tab.label}`}
        data-placement={maximized ? 'maximized' : 'floating'}
        className={cn('action-terminal-panel fixed z-40 flex flex-col overflow-hidden rounded-xl', moving && 'action-terminal-panel--moving')}
        style={boxStyle}
        onKeyDownCapture={(e) => {
          // ⌘W hides, like the bar's ×; Escape and everything else go to the terminal.
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
            e.preventDefault();
            e.stopPropagation();
            hide();
          }
        }}
      >
        <div
          data-terminal-bar
          className={cn('flex h-9 shrink-0 select-none items-center gap-2 border-b border-[var(--theme-border-subtle)] bg-[var(--theme-bg-hover)] px-3 text-xs', !maximized && 'cursor-grab active:cursor-grabbing')}
          onMouseDown={onBarMouseDown}
          onDoubleClick={(e) => {
            if (!onAButton(e)) onToggleMaximized();
          }}
        >
          {action?.icon && <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[var(--theme-text-primary)]">{renderIcon(action, 14)}</span>}
          <span className="shrink-0 font-semibold text-[var(--theme-text-primary)]">{tab.label}</span>
          <span className="text-[var(--theme-text-faint)]">—</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--theme-text-muted)]" title={tab.command}>{tab.command}</code>
          {running && run && <RunningBadge startedAt={run.startedAt} format={clock} />}
          <div className="flex shrink-0 items-center gap-1">
            <WindowButton kind={maximized ? 'restore' : 'maximize'} label={maximized ? 'Restore size (double-click the bar)' : 'Maximize (double-click the bar)'} onClick={onToggleMaximized} />
            <WindowButton kind="hide" label="Hide (⌘W) — the terminals keep running; click an action to bring it back" onClick={hide} />
          </div>
        </div>
        <div role="tablist" aria-label="Action terminals" className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-[var(--theme-border-subtle)] px-2 pt-1.5">
          {tabs.map((t) => (
            <TabButton key={t.key} tab={t} active={t.key === tab.key} onSelect={() => focusTerminal(t.key)} />
          ))}
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
      {!maximized && <ResizeHandles x={x} y={y} width={width} height={height} onStart={onResizeStart} />}
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

/** A tab: a click shows its terminal; the × that appears on hover kills it. */
function TabButton({ tab, active, onSelect }: { tab: TerminalTab; active: boolean; onSelect: () => void }) {
  const run = useTabRun(tab);
  const action = useSourceAction(tab.sourceId);
  const ok = run?.finishedAt ? run.exitCode === 0 && !run.cancelled : null;
  return (
    <div
      className={cn(
        'group flex max-w-[200px] shrink-0 items-center rounded-t-md text-[11px]',
        active ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]',
      )}
    >
      <button type="button" role="tab" aria-selected={active} title={tab.command} onClick={onSelect} className="flex min-w-0 items-center gap-1.5 py-1 pl-2.5 pr-1">
        <span
          aria-label={ok === null ? 'running' : ok ? 'succeeded' : 'failed'}
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ok === null ? 'animate-pulse bg-[var(--theme-accent)] motion-reduce:animate-none' : ok ? 'bg-[var(--theme-success)]' : 'bg-[var(--theme-danger)]')}
        />
        <span className="truncate">{tab.label}</span>
      </button>
      <Tooltip label="Kill this terminal">
        <button
          type="button"
          aria-label={`Kill ${tab.label}`}
          data-kill-tab={tab.key}
          onClick={() => killTab(tab, action)}
          className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[var(--theme-bg-surface)] hover:text-[var(--theme-danger)] focus-visible:opacity-100 group-hover:opacity-100"
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>
      </Tooltip>
    </div>
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
