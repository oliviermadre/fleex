/**
 * Assignee picker — unassigned, me, or an agent persona. Lifted unchanged from
 * the retired ticket-detail sidebar; used by the Work view's Context panel.
 */
import { useEffect } from 'react';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';

export function AssigneeField({
  assignee,
  onChange,
}: {
  assignee: string | null;
  onChange: (assignee: string | null) => void;
}) {
  const personas = useAgentPersonaStore((s) => s.personas);
  const loaded = useAgentPersonaStore((s) => s.loaded);
  const loadPersonas = useAgentPersonaStore((s) => s.loadPersonas);
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({
    placement: 'bottom-start',
  });

  useEffect(() => {
    if (!loaded) loadPersonas();
  }, [loaded, loadPersonas]);

  const handleSelect = (name: string | null) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div className="relative">
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
        Assignee
      </label>
      <button
        ref={refs.setReference}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
          assignee
            ? 'border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]'
            : 'border-dashed border-[var(--theme-border)] text-[10px] text-[var(--theme-text-muted)] hover:border-[var(--theme-border-input)] hover:text-[var(--theme-text-secondary)]',
        )}
        {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
      >
        {assignee ? (
          <>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-text-muted)]">
              <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-3.3 0-6 1.34-6 3v1h12v-1c0-1.66-2.7-3-6-3z" />
            </svg>
            <span className="flex-1 truncate text-left">{assignee === 'user' ? 'Me' : assignee}</span>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-text-faint)]">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </>
        ) : (
          <span className="flex-1 text-left">+ Assign</span>
        )}
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 min-w-[200px] rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-lg"
          >
          {/* Unassigned option */}
          <button
            className={cn(
              'flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
              assignee === null
                ? 'text-[var(--theme-text-primary)] font-medium'
                : 'text-[var(--theme-text-secondary)]',
            )}
            onClick={() => handleSelect(null)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-shrink-0 text-[var(--theme-text-faint)]">
              <circle cx="8" cy="8" r="6" />
              <line x1="5" y1="8" x2="11" y2="8" />
            </svg>
            <span>Unassigned</span>
            {assignee === null && (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="ml-auto flex-shrink-0 text-[var(--theme-accent)]">
                <path d="M6.5 12.5l-4-4 1.5-1.5L6.5 9.5l6-6L14 5z" />
              </svg>
            )}
          </button>

          {/* Me (human) option */}
          <button
            className={cn(
              'flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
              assignee === 'user'
                ? 'text-[var(--theme-text-primary)] font-medium'
                : 'text-[var(--theme-text-secondary)]',
            )}
            onClick={() => handleSelect('user')}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-text-muted)]">
              <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-3.3 0-6 1.34-6 3v1h12v-1c0-1.66-2.7-3-6-3z" />
            </svg>
            <span>Me</span>
            {assignee === 'user' && (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="ml-auto flex-shrink-0 text-[var(--theme-accent)]">
                <path d="M6.5 12.5l-4-4 1.5-1.5L6.5 9.5l6-6L14 5z" />
              </svg>
            )}
          </button>

          {personas.length > 0 && (
            <div className="mx-2 my-1 border-t border-[var(--theme-border)]" />
          )}

          {/* Persona options */}
          {personas.map((p) => (
            <button
              key={p.id}
              className={cn(
                'flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
                assignee === p.name
                  ? 'text-[var(--theme-text-primary)] font-medium'
                  : 'text-[var(--theme-text-secondary)]',
              )}
              onClick={() => handleSelect(p.name)}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-text-muted)]">
                <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-3.3 0-6 1.34-6 3v1h12v-1c0-1.66-2.7-3-6-3z" />
              </svg>
              <span className="truncate">{p.displayName}</span>
              <span className="ml-auto truncate text-[10px] text-[var(--theme-text-faint)]">{p.name}</span>
              {assignee === p.name && (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 text-[var(--theme-accent)]">
                  <path d="M6.5 12.5l-4-4 1.5-1.5L6.5 9.5l6-6L14 5z" />
                </svg>
              )}
            </button>
          ))}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
