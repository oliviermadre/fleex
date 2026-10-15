/**
 * Trash button + confirmation for a deliverable, shared by the Docs panel card
 * and the inline stream card. The click never bubbles (the cards open the
 * overlay on click). On confirm it deletes through the API and tells the caller
 * so the list drops the card at once — the `deliverable:deleted` WS frame that
 * follows is idempotent. A failure keeps the card and raises a toast.
 */
import { useState } from 'react';
import type { TicketDeliverable } from '@fleex/shared';
import * as api from '../../../services/api';
import { useToastStore } from '../../../stores/toastStore';
import { tintClasses } from '../../../lib/tints';
import { cn } from '../../../lib/cn';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { TrashIcon } from './TrashIcon';

interface Props {
  ticketId: string;
  deliverable: Pick<TicketDeliverable, 'id' | 'title'>;
  onDeleted?: (id: string) => void;
  /** Visibility classes — the host decides which hover group reveals it. */
  className?: string;
}

export function DeleteDeliverableButton({ ticketId, deliverable, onDeleted, className }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const red = tintClasses('red');

  const confirm = async () => {
    setBusy(true);
    try {
      await api.deleteDeliverable(ticketId, deliverable.id);
      onDeleted?.(deliverable.id);
    } catch (e) {
      useToastStore.getState().addToast('error', e instanceof Error ? e.message : "Couldn't delete deliverable");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  // The modal is portalled, but React events still bubble through the component
  // tree — swallow clicks here so neither the trash nor the dialog opens the card.
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      <span
        role="button"
        tabIndex={0}
        title="Delete deliverable"
        aria-label="Delete deliverable"
        onClick={() => setConfirming(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setConfirming(true);
          }
        }}
        className={cn(
          'shrink-0 cursor-pointer rounded p-1 text-[var(--theme-text-faint)] transition-opacity focus-visible:opacity-100',
          red.hoverBg,
          red.hoverText,
          className,
        )}
      >
        <TrashIcon />
      </span>
      <ConfirmModal
        open={confirming}
        title="Delete deliverable?"
        message={`"${deliverable.title}" will be permanently deleted.`}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setConfirming(false)}
      />
    </span>
  );
}
