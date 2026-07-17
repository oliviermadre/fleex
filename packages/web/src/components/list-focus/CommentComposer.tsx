import { useCallback, useRef, useState } from 'react';
import * as api from '../../services/api';
import { useCommentDraft } from '../../hooks/useCommentDraft';
import { useUnreadStore } from '../../stores/unreadStore';
import { cn } from '../../lib/cn';

/**
 * Minimal comment composer — the cockpit's "relaunch agent" action. Posting a
 * comment that @mentions an agent wakes that agent (the server resolves the
 * ticket's conversation-scoped mode/model at acknowledge time, so no per-message
 * execution mode is sent). Draft text persists per-ticket via localStorage so it
 * survives ↑/↓ selection changes and closing the inspector.
 *
 * This is intentionally NOT the full TicketComments composer (mentions
 * autocomplete, conflict disambiguation): the cockpit is a fast triage surface,
 * and the full thread lives one click away in the ticket panel.
 */
export function CommentComposer({ ticketId, autoFocus }: { ticketId: string; autoFocus?: boolean }) {
  const { draft, setDraft, clearDraft } = useCommentDraft(ticketId);
  const [submitting, setSubmitting] = useState(false);
  const markCommentsRead = useUnreadStore((s) => s.markCommentsRead);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const comment = await api.postTicketComment(ticketId, trimmed);
      // We just posted → we're caught up on this ticket's comments.
      markCommentsRead(ticketId, comment.createdAt).catch(() => {});
      clearDraft();
    } catch {
      // Keep the draft so the human can retry.
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus();
    }
  }, [draft, submitting, ticketId, markCommentsRead, clearDraft]);

  const canSend = !!draft.trim() && !submitting;

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={textareaRef}
        value={draft}
        autoFocus={autoFocus}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Don't let ↑/↓/Escape bubble to the inspector's nav handler while typing.
          e.stopPropagation();
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="Write a comment… @mention an agent to relaunch it"
        rows={4}
        className="w-full resize-y rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-2.5 py-2 text-sm text-[var(--theme-text-primary)] placeholder-[var(--theme-text-muted)] transition-colors focus:border-[var(--theme-accent)] focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--theme-text-faint)]">&#8984;&#9166; to send</span>
        <button
          onClick={() => void submit()}
          disabled={!canSend}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            canSend
              ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)] hover:opacity-90'
              : 'cursor-not-allowed bg-[var(--theme-bg-overlay)] text-[var(--theme-text-faint)]',
          )}
        >
          {submitting ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
