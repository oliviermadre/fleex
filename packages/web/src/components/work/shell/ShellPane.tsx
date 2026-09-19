/**
 * One shell pane. Binding is explicit and pane-local:
 *  - bound → a header whose title opens a dropdown to switch the binding (any
 *    unshown session, or a new shell) and a ✕ that UNBINDS the session (the pane
 *    goes empty; the session keeps running), over the xterm terminal.
 *  - empty → a centred menu to bind an unshown session or open a new shell.
 * Panes never change the layout — that's the tab bar's preset buttons only.
 *
 * The terminal mirrors the app's bottom panel (SidebarBottomPanel): a `relative`
 * box with the xterm `absolute inset-0`, so it's sized purely by its parent and
 * never feeds its height back into the flex layout. useTerminal owns resize.
 */
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { useTerminal } from '../../../hooks/useTerminal';
import { terminalManager } from '../../../services/terminalManager';

function ShellTerminal({ sessionId, autoFocus }: { sessionId: string; autoFocus: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(sessionId, containerRef);
  // Focused here rather than by whoever asked for the shell: terminalManager is
  // a plain Map, so an outside watcher that finds no terminal yet never hears
  // when one appears. This effect is declared after useTerminal's, so React runs
  // it in the same commit, once the terminal has been created and attached.
  useEffect(() => {
    if (!autoFocus) return;
    terminalManager.get(sessionId)?.terminal.focus();
  }, [autoFocus, sessionId]);
  return (
    <div className="relative min-h-0 flex-1">
      <div ref={containerRef} className="xterm-container absolute inset-0" />
    </div>
  );
}

/** Purple dot = claude session, green = plain shell (SPEC §7). */
function SessionDot({ type }: { type: Session['type'] }) {
  return (
    <span
      className={cn(
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
        type === 'claude' ? 'bg-[var(--tint-purple-solid)]' : 'bg-[var(--tint-green-solid)]',
      )}
    />
  );
}

/** The choices shared by the title dropdown and the empty-pane menu. */
function BindList({
  bindable,
  creating,
  onBind,
  onNewShell,
}: {
  bindable: Session[];
  creating: boolean;
  onBind: (id: string) => void;
  onNewShell: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-0.5">
      {bindable.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onBind(s.id);
          }}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
        >
          <SessionDot type={s.type} />
          <span className="truncate">{s.displayName}</span>
        </button>
      ))}
      {bindable.length > 0 && <div className="my-0.5 h-px bg-[var(--theme-border)]" />}
      <button
        type="button"
        disabled={creating}
        onClick={(e) => {
          e.stopPropagation();
          onNewShell();
        }}
        className="rounded px-2 py-1 text-left text-[11px] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)] disabled:opacity-50"
      >
        {creating ? 'creating…' : '+ new shell'}
      </button>
    </div>
  );
}

export function ShellPane({
  session,
  focused,
  bindable,
  onFocus,
  onUnbind,
  onBind,
  onNewShell,
  creating,
  autoFocus = false,
}: {
  session: Session | null;
  focused: boolean;
  /** Existing sessions not shown elsewhere — offered by the bind menu. */
  bindable: Session[];
  /** This pane's session was just opened: its terminal takes the keyboard. */
  autoFocus?: boolean;
  onFocus: () => void;
  onUnbind: () => void;
  onBind: (sessionId: string) => void;
  onNewShell: () => void;
  creating: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const bind = (id: string) => {
    onBind(id);
    setMenuOpen(false);
  };
  const newShell = () => {
    onNewShell();
    setMenuOpen(false);
  };

  return (
    <div
      ref={rootRef}
      onMouseDown={onFocus}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-sm bg-[var(--theme-bg-base)]"
    >
      {/* Focus outline as an overlay ABOVE the terminal — an inset ring on the pane
          itself is painted over by the xterm's absolute-inset canvas. */}
      {focused && (
        <div className="pointer-events-none absolute inset-0 z-10 rounded-sm border-2 border-[var(--tint-indigo-solid)]" />
      )}
      {session ? (
        <>
          <div className="flex h-6 shrink-0 items-center gap-1.5 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] pl-2 pr-1 text-[11px] text-[var(--theme-text-muted)]">
            <button
              type="button"
              title="Change the bound shell"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
              className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 hover:bg-[var(--theme-bg-hover)]"
            >
              <SessionDot type={session.type} />
              <span className="truncate text-[var(--theme-text-secondary)]">{session.displayName}</span>
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="m3 4.5 3 3 3-3" />
              </svg>
            </button>
            <span className="min-w-0 flex-1 truncate text-[var(--theme-text-faint)]">· {session.cwd}</span>
            <button
              type="button"
              title="Unbind this shell from the pane"
              onClick={(e) => {
                e.stopPropagation();
                onUnbind();
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <line x1="3" y1="3" x2="9" y2="9" />
                <line x1="9" y1="3" x2="3" y2="9" />
              </svg>
            </button>
          </div>

          {menuOpen && (
            <div className="absolute left-2 top-6 z-20 mt-1 w-[240px] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-1 shadow-lg">
              <BindList bindable={bindable} creating={creating} onBind={bind} onNewShell={newShell} />
            </div>
          )}

          <ShellTerminal sessionId={session.id} autoFocus={autoFocus} />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-3">
          <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--theme-text-faint)]">Empty pane</span>
          <div className="w-full max-w-[240px] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-1">
            <BindList bindable={bindable} creating={creating} onBind={bind} onNewShell={newShell} />
          </div>
        </div>
      )}
    </div>
  );
}
