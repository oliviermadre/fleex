import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { TicketDeliverable } from '@fleex/shared';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { useDocumentsStore } from '../../stores/documentsStore';
import { useToastStore } from '../../stores/toastStore';
import { useClickOutside } from '../../hooks/useClickOutside';
import { cn } from '../../lib/cn';
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
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useClickOutside([triggerRef, menuRef], () => setOpen(false), open);

  const rect = triggerRef.current?.getBoundingClientRect();
  const selectable = types.filter((t) => !t.system);

  const select = async (typeId: string) => {
    setOpen(false);
    if (typeId === deliverable.type) return;
    try {
      const updated = await api.changeDeliverableType(deliverable.id, typeId);
      onChanged?.(updated);
      const docs = useDocumentsStore.getState();
      if (docs.deliverables.length > 0) docs.fetchAll();
      useDeliverableTypesStore.getState().load(); // refresh usage counts
      useToastStore.getState().addToast('success', `Type changed to ${labelFor(typeId)}`);
    } catch {
      // error toast handled by api.ts
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="cursor-pointer rounded transition-opacity hover:opacity-70 focus:outline-none"
        title="Click to change type"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        {children}
      </button>

      {open && rect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[1000] max-h-[60vh] min-w-[240px] overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          style={{ left: rect.left, top: rect.bottom + 4 }}
        >
          {selectable.map((t) => (
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
                style={{ color: t.color?.text ?? 'var(--theme-accent)' }}
              >
                {t.label}
              </span>
              {t.description && (
                <span className="text-[10px] text-[var(--theme-text-faint)]">{t.description}</span>
              )}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
