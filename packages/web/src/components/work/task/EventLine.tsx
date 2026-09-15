/**
 * A domain event line in the conversation stream (SPEC §5): a small, muted,
 * centered row with a ✓ prefix — "Ticket created", "Moved to Reviewing",
 * "Worktree created", etc. Purely informational; it carries no action.
 */
export function EventLine({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-0.5 text-[11px] text-[var(--theme-text-faint)]">
      <span aria-hidden className="text-[var(--tint-green-text)]">✓</span>
      <span className="truncate">{text}</span>
    </div>
  );
}
