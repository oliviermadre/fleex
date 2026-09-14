/**
 * The shell tab bar, shared by the drawer and shell mode (SPEC §7): a `>_` badge,
 * one tab per ticket session (purple dot = claude, green = shell), a `+` for a new
 * shell, the layout presets and the shell-mode toggle. Clicking a tab shows that
 * session in the focused pane; double-click renames; the ✕ on hover kills. A tab is
 * highlighted while its session is shown in some pane. No hide control — the drawer
 * is toggled from the nav Shell button and shell mode is left via "Back to chat".
 */
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { useWorkStore, type ShellLayout } from '../../../stores/workStore';

const PRESETS: { layout: ShellLayout; glyph: string; title: string }[] = [
  { layout: '1', glyph: '▭', title: 'Single' },
  { layout: 'cols', glyph: '◫', title: 'Split right' },
  { layout: 'rows', glyph: '⊟', title: 'Split down' },
  { layout: 'three', glyph: '◨', title: 'One + two stacked' },
  { layout: 'grid', glyph: '⊞', title: '2×2 grid' },
];

function Dot({ type }: { type: Session['type'] }) {
  return (
    <span
      className={cn(
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
        type === 'claude' ? 'bg-[var(--tint-purple-solid)]' : 'bg-[var(--tint-green-solid)]',
      )}
    />
  );
}

function Tab({
  session,
  active,
  onSelect,
  onKill,
  onRename,
}: {
  session: Session;
  active: boolean;
  onSelect: () => void;
  onKill: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.displayName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== session.displayName) onRename(draft.trim());
    else setDraft(session.displayName);
  };

  return (
    <div
      onClick={() => {
        if (!editing) onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(session.displayName);
        setEditing(true);
      }}
      title={`${session.cwd} — click to show in the focused pane, double-click to rename`}
      className={cn(
        'group flex shrink-0 cursor-pointer items-center gap-1.5 rounded px-2 py-1 transition-colors',
        active
          ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]'
          : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      <Dot type={session.type} />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(session.displayName);
              setEditing(false);
            }
          }}
          className="w-[120px] rounded bg-[var(--theme-bg-base)] px-1 text-[11px] text-[var(--theme-text-primary)] outline-none ring-1 ring-[var(--tint-indigo-solid)]"
        />
      ) : (
        <span className="max-w-[140px] truncate">{session.displayName}</span>
      )}
      <button
        type="button"
        title="Close shell"
        onClick={(e) => {
          e.stopPropagation();
          onKill();
        }}
        className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--theme-text-faint)] opacity-0 hover:bg-[var(--theme-bg-base)] hover:text-[var(--theme-text-primary)] group-hover:opacity-100"
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <line x1="3" y1="3" x2="9" y2="9" />
          <line x1="9" y1="3" x2="3" y2="9" />
        </svg>
      </button>
    </div>
  );
}

export function ShellTabBar({
  sessions,
  shownIds,
  creating,
  onSelectTab,
  onNewShell,
  onKill,
  onRename,
}: {
  sessions: Session[];
  shownIds: Set<string>;
  creating: boolean;
  onSelectTab: (id: string) => void;
  onNewShell: () => void;
  onKill: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const shellLayout = useWorkStore((s) => s.shellLayout);
  const setShellLayout = useWorkStore((s) => s.setShellLayout);
  const shellMode = useWorkStore((s) => s.shellMode);
  const setShellMode = useWorkStore((s) => s.setShellMode);

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 text-[11px]">
      <span className="mr-1 font-mono text-[var(--theme-text-muted)]">{'>_'}</span>

      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {sessions.map((s) => (
          <Tab
            key={s.id}
            session={s}
            active={shownIds.has(s.id)}
            onSelect={() => onSelectTab(s.id)}
            onKill={() => onKill(s.id)}
            onRename={(name) => onRename(s.id, name)}
          />
        ))}
        <button
          type="button"
          disabled={creating}
          onClick={onNewShell}
          title="New shell"
          className="shrink-0 rounded px-2 py-1 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)] disabled:opacity-50"
        >
          {creating ? '…' : '+'}
        </button>
      </div>

      <div className="mx-1 flex items-center gap-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.layout}
            type="button"
            onClick={() => setShellLayout(p.layout)}
            title={p.title}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded text-[12px]',
              shellLayout === p.layout
                ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]'
                : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
            )}
          >
            {p.glyph}
          </button>
        ))}
      </div>

      {/* In the drawer, this expands to full Shell mode. In Shell mode itself the
          top-bar ModeSwitcher owns switching, so we don't duplicate a back button. */}
      {!shellMode && (
        <button
          type="button"
          onClick={() => setShellMode(true)}
          title="Shell mode"
          className="flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
          </svg>
          Shell mode
        </button>
      )}
    </div>
  );
}
