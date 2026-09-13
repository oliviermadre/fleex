/**
 * Contextual suggestion chips above the composer (SPEC §5). A status-move chip
 * advances the ticket via the real mutation API; a persona chip seeds an
 * @mention into the composer (the composer's mention pipeline takes it from
 * there). The rule set (suggestionsFor) only surfaces actions Phase 1 performs.
 */
import { useTicketStore } from '../../../stores/ticketStore';
import { suggestionsFor } from '../selectors';
import type { WorkTask } from '../types';

interface Props {
  task: WorkTask;
  onSeedComposer: (text: string) => void;
}

export function Suggestions({ task, onSeedComposer }: Props) {
  const moveTicket = useTicketStore((s) => s.moveTicket);
  const chips = suggestionsFor({ status: task.status, type: task.type, hasPR: task.pr != null });
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-1 pt-2">
      <span className="text-[10.5px] font-semibold tracking-[0.06em] text-[var(--theme-text-muted)]">
        SUGGESTED
      </span>
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => {
            if (c.moveTo) void moveTicket(task.id, c.moveTo);
            else if (c.mention) onSeedComposer(c.mention);
          }}
          className="rounded-md border border-[var(--theme-border)] px-2 py-0.5 text-[11px] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
