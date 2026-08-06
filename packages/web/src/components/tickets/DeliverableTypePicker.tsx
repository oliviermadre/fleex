import { type ReactNode } from 'react';
import type { TicketDeliverable } from '@fleex/shared';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { useDocumentsStore } from '../../stores/documentsStore';
import { useRoutineStore } from '../../stores/routineStore';
import { useToastStore } from '../../stores/toastStore';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';
import { themedTypeColor } from '../../lib/tints';
import * as api from '../../services/api';

/**
 * Click-to-change deliverable type. Wraps a host-rendered badge (passed as
 * children) and opens a popover listing the configured types as coloured
 * labels + descriptions — mirroring the kanban ticket TypePickerPopover.
 *
 * Persistence (API call + usage refresh + Documents refresh + toast) is handled
 * here; `onChanged` lets the host sync its own local view of the deliverable.
 */
export function DeliverableTypePicker({
  deliverable,
  children,
  onChanged,
}: {
  deliverable: TicketDeliverable;
  children: ReactNode;
  onChanged?: (updated: TicketDeliverable) => void;
}) {
  const types = useDeliverableTypesStore((s) => s.types);
  const labelFor = useDeliverableTypesStore((s) => s.labelFor);
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover();

  const selectable = types.filter((t) => !t.system);

  const select = async (typeId: string) => {
    setOpen(false);
    if (typeId === deliverable.type) return;
    try {
      const updated = await api.changeDeliverableType(deliverable.id, typeId);
      onChanged?.(updated);
      const docs = useDocumentsStore.getState();
      if (docs.deliverables.length > 0) docs.fetchAll(); // refresh rows + sidebar counts
      useRoutineStore.getState().applyDeliverableUpdate(updated); // routine run lists
      useDeliverableTypesStore.getState().load(); // refresh usage counts
      useToastStore.getState().addToast('success', `Type changed to ${labelFor(typeId)}`);
    } catch {
      // error toast handled by api.ts
    }
  };

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className="cursor-pointer rounded transition-opacity hover:opacity-70 focus:outline-none"
        title="Click to change type"
        onMouseDown={(e) => e.stopPropagation()}
        {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
      >
        {children}
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[1000] min-w-[240px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            {selectable.map((t) => {
              // Themed, not raw: preset colours are remapped to `var(--tint-*)`
              // so the option stays readable in the light theme too.
              const color = themedTypeColor(t.color ?? null);
              return (
              <button
                key={t.id}
                type="button"
                className={cn(
                  'flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-[var(--theme-bg-hover)]',
                  t.id === deliverable.type ? 'bg-[var(--theme-bg-hover)]' : '',
                )}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); select(t.id); }}
              >
                <span
                  className="text-xs font-medium"
                  style={{ color: color?.text ?? 'var(--theme-accent)' }}
                >
                  {t.label}
                </span>
                {t.description && (
                  <span className="text-[10px] text-[var(--theme-text-faint)]">{t.description}</span>
                )}
              </button>
              );
            })}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
