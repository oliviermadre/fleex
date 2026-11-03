/**
 * The saved-view picker on top of the queue: « All tasks », then the user's
 * views (rename / duplicate / delete on hover), then « New view… ». The trigger
 * shows the active view, with a dot when its filters were changed and not saved.
 * Disabled, with a tooltip, when the storage has no saved views (501).
 */
import { usePopover, FloatingPortal } from '../../../hooks/usePopover';
import { cn } from '../../../lib/cn';
import { Tooltip } from '../../ui/Tooltip';
import type { SavedView, SavedViewsStatus } from '../../../stores/savedViewsStore';

interface Props {
  views: readonly SavedView[];
  status: SavedViewsStatus;
  active: SavedView | null;
  dirty: boolean;
  onSwitch: (id: string | null) => void;
  onNew: () => void;
  onRename: (view: SavedView) => void;
  onDuplicate: (view: SavedView) => void;
  onDelete: (view: SavedView) => void;
  onRetry: () => void;
}

const UNAVAILABLE = 'Views are unavailable on this storage';

function DirtyDot() {
  return <span aria-label="Modified" title="Modified, not saved" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--theme-accent)]" />;
}

function RowAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex h-5 w-5 items-center justify-center rounded text-[11px] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
        danger ? 'hover:text-[var(--theme-danger)]' : 'hover:text-[var(--theme-text-primary)]',
      )}
    >
      {children}
    </button>
  );
}

export function ViewPicker({ views, status, active, dirty, onSwitch, onNew, onRename, onDuplicate, onDelete, onRetry }: Props) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ maxHeight: 420 });
  const unavailable = status === 'unavailable';
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const trigger = (
    <button
      ref={refs.setReference}
      {...getReferenceProps()}
      type="button"
      disabled={unavailable}
      data-testid="view-picker"
      className={cn(
        'flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-left transition-colors',
        open ? 'border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)]' : 'hover:bg-[var(--theme-bg-hover)]',
        unavailable && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className="shrink-0 text-[13px]">{active?.emoji || '▤'}</span>
      <span className="truncate text-[13px] font-semibold text-[var(--theme-text-primary)]">{active ? active.name : 'All tasks'}</span>
      {dirty && <DirtyDot />}
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" className="ml-auto shrink-0 text-[var(--theme-text-muted)]">
        <path d="M4 6l4 4 4-4" />
      </svg>
    </button>
  );

  return (
    <>
      {unavailable ? <Tooltip label={UNAVAILABLE}><span className="flex min-w-0 flex-1">{trigger}</span></Tooltip> : trigger}

      {open && !unavailable && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-[260px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            <button
              type="button"
              onClick={pick(() => onSwitch(null))}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--theme-bg-hover)]',
                !active ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-secondary)]',
              )}
            >
              <span className="w-4 text-center">▤</span>
              All tasks
            </button>

            <div className="my-1 border-t border-[var(--theme-border)]" />
            <div className="px-3 pb-1 pt-1 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]">My views</div>
            {status === 'loading' && views.length === 0 && (
              <div className="px-3 py-1.5 text-[11px] text-[var(--theme-text-faint)]">Loading…</div>
            )}
            {status === 'error' && views.length === 0 && (
              <button type="button" onClick={onRetry} className="px-3 py-1.5 text-left text-[11px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]">
                Couldn't load the views — retry
              </button>
            )}
            {status === 'ready' && views.length === 0 && (
              <div className="px-3 py-1.5 text-[11px] text-[var(--theme-text-faint)]">No view yet.</div>
            )}
            {views.map((v) => (
              <div
                key={v.id}
                role="menuitem"
                tabIndex={0}
                onClick={pick(() => onSwitch(v.id))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') pick(() => onSwitch(v.id))();
                }}
                className={cn(
                  'group flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] transition-colors hover:bg-[var(--theme-bg-hover)]',
                  active?.id === v.id ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-secondary)]',
                )}
              >
                <span className="w-4 shrink-0 text-center">{v.emoji || '▤'}</span>
                <span className="truncate">{v.name}</span>
                {active?.id === v.id && dirty && <DirtyDot />}
                <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <RowAction label="Rename" onClick={pick(() => onRename(v))}>✎</RowAction>
                  <RowAction label="Duplicate" onClick={pick(() => onDuplicate(v))}>⧉</RowAction>
                  <RowAction label="Delete" danger onClick={pick(() => onDelete(v))}>🗑</RowAction>
                </span>
              </div>
            ))}

            <div className="my-1 border-t border-[var(--theme-border)]" />
            <button
              type="button"
              onClick={pick(onNew)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-accent)]"
            >
              <span className="w-4 text-center">＋</span>
              New view…
            </button>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
