import { useState } from 'react';
import { useAgendaStore, type AgendaSavedView } from '../../stores/agendaStore';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { NameInputModal } from '../ui/NameInputModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { cn } from '../../lib/cn';
import { BookmarkIcon, MoreIcon, PlusIcon } from '../ui/icons/AgendaIcons';

const menuItem = 'block w-full rounded px-2 py-1 text-left hover:bg-[var(--theme-bg-hover)]';

function ViewMenu({ view, onRename, onDelete }: { view: AgendaSavedView; onRename: () => void; onDelete: () => void }) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ placement: 'bottom-end' });
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        aria-label={`Actions for ${view.name}`}
        className={cn(
          'grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]',
          !open && 'opacity-0 group-hover:opacity-100 focus:opacity-100',
        )}
      >
        <MoreIcon size={12} />
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-52 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-1 text-xs text-[var(--theme-text-secondary)] shadow-xl"
          >
            <button type="button" role="menuitem" className={menuItem} onClick={pick(() => void useAgendaStore.getState().updateSavedView(view.id))}>
              Update with current filters
            </button>
            <button type="button" role="menuitem" className={menuItem} onClick={pick(onRename)}>Rename</button>
            <button type="button" role="menuitem" className={cn(menuItem, 'text-[var(--theme-danger)]')} onClick={pick(onDelete)}>Delete</button>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/**
 * A23 — saved agenda views in the sidebar: labels, routines, filters and the
 * view mode, under a name. Hidden when the storage has no saved views (501).
 */
export function AgendaSavedViews() {
  const savedViews = useAgendaStore((s) => s.savedViews);
  const activeViewId = useAgendaStore((s) => s.activeViewId);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<AgendaSavedView | null>(null);
  const [deleting, setDeleting] = useState<AgendaSavedView | null>(null);

  if (savedViews === null) return null;
  const store = useAgendaStore.getState;

  return (
    <div className="mt-4" data-testid="agenda-saved-views">
      <div className="mb-1 flex items-center text-[10.5px] uppercase tracking-wide text-[var(--theme-text-muted)]">
        <span className="flex-1">Saved views</span>
        <button
          type="button"
          aria-label="Save current view"
          title="Save current view"
          onClick={() => setCreating(true)}
          className="grid h-5 w-5 place-items-center rounded normal-case hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
        >
          <PlusIcon size={12} />
        </button>
      </div>
      {savedViews.length === 0 && (
        <button type="button" onClick={() => setCreating(true)} className="px-1 text-left text-[11px] text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)]">
          Save the current labels and filters as a view
        </button>
      )}
      {savedViews.map((v) => {
        const active = v.id === activeViewId;
        return (
          <div
            key={v.id}
            className={cn(
              'group flex items-center gap-1 rounded pr-1',
              active ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
            )}
          >
            <button
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => store().applySavedView(v.id)}
              className="flex min-w-0 flex-1 items-center gap-2 px-1 py-0.5 text-left"
            >
              <BookmarkIcon size={12} className={active ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-muted)]'} />
              <span className={cn('truncate', active && 'font-semibold')}>{v.name}</span>
            </button>
            <ViewMenu view={v} onRename={() => setRenaming(v)} onDelete={() => setDeleting(v)} />
          </div>
        );
      })}

      <NameInputModal
        open={creating}
        title="Save current view"
        placeholder="e.g. Routines only"
        confirmLabel="Save"
        onConfirm={(name) => void store().saveCurrentAsView(name)}
        onClose={() => setCreating(false)}
      />
      <NameInputModal
        open={renaming !== null}
        title="Rename view"
        defaultValue={renaming?.name ?? ''}
        confirmLabel="Rename"
        onConfirm={(name) => renaming && void store().renameSavedView(renaming.id, name)}
        onClose={() => setRenaming(null)}
      />
      <ConfirmModal
        open={deleting !== null}
        title="Delete view"
        message={<>Delete the view <strong>{deleting?.name}</strong>? Your current filters stay as they are.</>}
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleting) void store().deleteSavedView(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
