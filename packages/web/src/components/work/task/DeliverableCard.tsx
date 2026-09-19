/**
 * A timeline card for a deliverable produced on the ticket (SPEC §5). Mirrors the
 * Delivs panel card — kind badge · title · author · draft/version — but inline in
 * the conversation, right after the comment that produced it. Clicking opens the
 * existing deliverable overlay (globally mounted) via the uiStore, marking it seen
 * first, exactly like the Delivs panel does.
 */
import type { TicketDeliverable } from '@fleex/shared';
import { useUIStore } from '../../../stores/uiStore';
import { useUnreadStore } from '../../../stores/unreadStore';
import { tint, tintText } from '../../../lib/tints';
import { cn } from '../../../lib/cn';
import { DeliverableTypeBadge } from '../../ui/DeliverableTypeBadge';

export function DeliverableCard({ deliverable: d }: { deliverable: TicketDeliverable }) {
  const openDeliverableOverlay = useUIStore((s) => s.openDeliverableOverlay);
  const toggleDeliverableSeen = useUnreadStore((s) => s.toggleDeliverableSeen);

  const open = () => {
    if (d.ticketId) void toggleDeliverableSeen(d.ticketId, d.id, true);
    openDeliverableOverlay(d);
  };

  return (
    <button
      type="button"
      onClick={open}
      title="Open deliverable"
      className="group flex w-full items-center gap-2 rounded-lg border-l-2 border-[var(--theme-accent)] border-y border-r border-y-[var(--theme-border)] border-r-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--theme-bg-hover)]"
    >
      <DeliverableTypeBadge type={d.type} size="xs" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-[var(--theme-text-primary)]">{d.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--theme-text-faint)]">
          {d.agentName && <span className={tintText('purple')}>{d.agentName}</span>}
          {d.status === 'draft' && (
            <span className={cn('rounded-full px-1.5 py-px text-[9px] font-medium', tint('yellow'))}>draft</span>
          )}
          {d.version > 1 && <span>v{d.version}</span>}
        </span>
      </span>
      <span className="shrink-0 text-[10.5px] text-[var(--theme-text-faint)] group-hover:text-[var(--theme-accent)]">open ›</span>
    </button>
  );
}
