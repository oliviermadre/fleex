import { useState, useEffect, useRef, useCallback } from 'react';
import type { TicketComment, TicketWsMessage } from '@asm/shared';
import { ticketWs } from '../../services/websocket';
import * as api from '../../services/api';

function renderBodyWithMentions(body: string): React.ReactNode[] {
  const parts = body.split(/(@agent:[a-zA-Z0-9_-]+)/g);
  return parts.map((part, i) =>
    part.startsWith('@agent:') ? (
      <span key={i} className="rounded-sm bg-[var(--theme-accent)]/15 px-1 py-px text-[var(--theme-accent)]">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function TicketComments({ ticketId }: { ticketId: string }) {
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const listEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.fetchTicketComments(ticketId).then(setComments).catch(() => {});
  }, [ticketId]);

  useEffect(() => {
    const decoder = new TextDecoder();
    const unsub = ticketWs.onMessage((buf: ArrayBuffer) => {
      try {
        const msg = JSON.parse(decoder.decode(buf)) as TicketWsMessage;
        if (msg.type === 'comment:created') {
          const comment = msg.data as TicketComment;
          if (comment.ticketId === ticketId) {
            setComments((prev) => {
              if (prev.some((c) => c.id === comment.id)) return prev;
              return [...prev, comment];
            });
          }
        }
      } catch {
        // ignore
      }
    });
    return unsub;
  }, [ticketId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

  const handleSubmit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      const comment = await api.postTicketComment(ticketId, trimmed);
      setComments((prev) => (prev.some((c) => c.id === comment.id) ? prev : [...prev, comment]));
      setBody('');
    } catch {
      // keep body so user can retry
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus();
    }
  }, [body, submitting, ticketId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* Comment list */}
      <div className="flex-1 overflow-y-auto">
        {comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-[var(--theme-text-muted)]">No comments yet</p>
            <p className="mt-1 text-xs text-[var(--theme-text-faint)]">
              Use <span className="font-mono text-[var(--theme-accent)]">@agent:name</span> to mention an agent
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--theme-border)]/50">
            {comments.map((c) => (
              <div key={c.id} className="px-1 py-3 first:pt-0">
                {/* Header: author + timestamp */}
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold ${
                      c.authorType === 'agent'
                        ? 'text-purple-400'
                        : 'text-blue-400'
                    }`}
                  >
                    {c.authorName}
                  </span>
                  <span className="text-[10px] text-[var(--theme-text-faint)]">
                    {c.authorType === 'agent' ? 'agent' : 'you'}
                  </span>
                  <span className="text-[10px] text-[var(--theme-text-faint)]">
                    {relativeTime(c.createdAt)}
                  </span>
                </div>
                {/* Body */}
                <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--theme-text-secondary)]">
                  {renderBodyWithMentions(c.body)}
                </div>
              </div>
            ))}
            <div ref={listEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-[var(--theme-border)] pt-3">
        <textarea
          ref={textareaRef}
          className="w-full resize-none rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-secondary)] placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)] focus:outline-none"
          rows={2}
          placeholder="Write a comment... (@agent:name to mention)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitting}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-[var(--theme-text-faint)]">
            {navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter to send
          </span>
          <button
            className="rounded-md bg-[var(--theme-accent)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            onClick={handleSubmit}
            disabled={submitting || !body.trim()}
          >
            {submitting ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
