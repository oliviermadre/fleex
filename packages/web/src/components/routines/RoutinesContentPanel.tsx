import { useEffect, useState } from 'react';
import { useRoutineStore } from '../../stores/routineStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useUIStore } from '../../stores/uiStore';
import type { RoutineListItem as RoutineListItemDto } from '../../services/api';
import { RoutineEditor } from './RoutineEditor';
import { AutomationSuggestions } from './AutomationSuggestions';
import { describeTrigger, formatRelativeTime } from './RoutineDetail';
import { ConfirmModal } from '../ui/ConfirmModal';
import { TrashIcon } from '../ui/TrashIcon';
import { RoutineIcon } from '../../lib/primitives';
import { Button } from '../ui/Button';
import { cn } from '../../lib/cn';
import { tint, tintClasses, tintText } from '../../lib/tints';

/**
 * Routines sidebar, mounted by `ContentPanel` — NOT a private aside inside the
 * main view. That placement is the whole point: it inherits the design-system
 * surface background, the collapse behaviour and the header geometry that every
 * other list panel (Agentic Catalog, Repositories, …) already has.
 *
 * Row actions follow the Agentic Catalog convention: edit (gear) and delete
 * (trash) are revealed on hover, and delete confirms before destroying the run
 * history. The detail header carries none of these — only Play lives there.
 */
export function RoutinesContentPanel() {
  const { routines, loading, error, selectedId, select, remove } = useRoutineStore();
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const refreshTemplates = useWorkflowTemplateStore((s) => s.refresh);
  const toggleContentPanel = useUIStore((s) => s.toggleContentPanel);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RoutineListItemDto | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<RoutineListItemDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  // The routine list itself is loaded (and kept live) by the nav sidebar; the
  // editor is what needs templates, and this panel is where the editor opens.
  useEffect(() => {
    if (templates.length === 0) void refreshTemplates();
    // Mount-only: the template store owns its own invalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDelete = async () => {
    if (!confirmingDelete) return;
    setDeleting(true);
    try {
      await remove(confirmingDelete.id);
      setConfirmingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {/* Header — same geometry as the Agentic Catalog panel. */}
      <div
        className="flex items-center justify-between border-b border-[var(--theme-border)] px-4"
        style={{ height: 'var(--header-height)' }}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Routines
          </span>
          <span className="text-[10px] font-medium text-[var(--theme-text-faint)]">{routines.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCreating(true)}
            title="New routine"
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
          <button
            onClick={toggleContentPanel}
            title="Collapse panel"
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
              <line x1="6" y1="1.5" x2="6" y2="14.5" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="px-4 py-3 text-xs text-[var(--theme-text-muted)]">Loading…</p>}
        {error && <p className={cn('px-4 py-3 text-xs', tintText('red'))}>{error}</p>}
        {!loading && !error && routines.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <RoutineIcon size={24} />
            <p className="text-xs text-[var(--theme-text-muted)]">
              No routine yet. A routine runs a workflow on a repo, a brief, or nothing at all — no ticket needed.
            </p>
            <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>Create one</Button>
          </div>
        )}
        {routines.map((r) => (
          <RoutineRow
            key={r.id}
            routine={r}
            selected={r.id === selectedId}
            onClick={() => void select(r.id)}
            onEdit={() => setEditing(r)}
            onDelete={() => setConfirmingDelete(r)}
          />
        ))}
      </div>

      {/* Sits below the list because it is a prompt to add one, not part of it. */}
      <AutomationSuggestions onCreate={() => setCreating(true)} />

      {(creating || editing) && (
        <RoutineEditor
          routine={editing ?? undefined}
          templates={templates}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}

      <ConfirmModal
        open={confirmingDelete !== null}
        title="Delete routine"
        message={<>Delete <strong>{confirmingDelete?.name}</strong>? Its run history will no longer be reachable.</>}
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmingDelete(null)}
      />
    </>
  );
}

function RoutineRow({ routine, selected, onClick, onEdit, onDelete }: {
  routine: RoutineListItemDto;
  selected: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full min-w-0 items-center gap-2 border-l-2 py-2.5 pl-4 pr-3 text-left transition-colors',
        selected
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
          : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      {/* Paused state must survive hover (the old trailing "paused" text hid
          behind the row actions): the icon dims and the subtitle says it. */}
      <RoutineIcon size={16} className={cn('flex-shrink-0', !routine.enabled && 'opacity-40')} />
      <div className={cn('flex min-w-0 flex-1 flex-col gap-0.5', !routine.enabled && 'opacity-60')}>
        <span className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">{routine.name}</span>
        <span className="truncate text-[11px] text-[var(--theme-text-muted)]">
          {!routine.enabled && 'paused · '}
          {describeTrigger(routine.trigger)}
          {routine.lastRunAt && ` · last run ${formatRelativeTime(routine.lastRunAt)}`}
        </span>
      </div>
      {routine.awaitingAttention && (
        <span className={cn('flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium group-hover:hidden', tint('yellow'))}>
          waiting
        </span>
      )}
      {/* Hover-revealed actions — same affordances as the Agentic Catalog rows. */}
      <span
        role="button"
        tabIndex={-1}
        title="Edit routine"
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        className="hidden shrink-0 items-center justify-center rounded p-0.5 text-[var(--theme-text-faint)] transition-colors hover:text-[var(--theme-text-secondary)] group-hover:flex"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </span>
      <span
        role="button"
        tabIndex={-1}
        title="Delete routine"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className={cn(
          'hidden shrink-0 items-center justify-center rounded p-0.5 text-[var(--theme-text-faint)] transition-colors group-hover:flex',
          tintClasses('red').hoverText,
        )}
      >
        <TrashIcon />
      </span>
    </button>
  );
}
