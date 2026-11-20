import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Composer } from '../components/work/task/Composer';
import * as api from '../services/api';
import { cn } from '../lib/cn';
import { useFactoryStore } from './factoryStore';

/* the reason is never sent on its own: only a decision button sends it, with the outcome */
const noop = () => {};
/** Rows the field grows to before it scrolls, folded and enlarged (⤢). Past 8 the reply area overflows a 480px peek. */
export const PEEK_ROWS = { folded: 4, enlarged: 8 } as const;

interface Props {
  ticketId: string;
  /** The gate the ticket waits at, if it does: its decision buttons replace the send. */
  gate: { name?: string; outcomes: string[] } | null;
  /** A station asked the ticket a question: the answer gives it back. */
  asked: boolean;
  failed: boolean;
  /** Re-reads the thread once something was said or decided. */
  reload: () => Promise<void>;
  onOpen: () => void;
  onClose: () => void;
}

/**
 * The foot of the peek: what is typed (an answer, or a gate's reason) and the buttons that act on it. Two rows: the
 * reply area grows up to a cap then scrolls, and gives way when the card is short; the button bar under it never
 * moves nor shrinks, however long the text. ⤢ lends the field the thread's room for a longer text without leaving
 * the floor; Open stays the way out for a real write-up. Mounted per ticket (keyed by the peek), so another ticket
 * starts from an empty, folded field.
 */
export function FactoryPeekReply({ ticketId, gate, asked, failed, reload, onOpen, onClose }: Props) {
  const store = useFactoryStore();
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  /* folded again, the field shows the end of the text, where the caret most likely is */
  useEffect(() => { const ta = field.current; if (!enlarged && ta) ta.scrollTop = ta.scrollHeight; }, [enlarged]);

  const act = async (fn: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    try { await fn(); after?.(); setEnlarged(false); await reload(); } catch { /* toast already shown */ } finally { setBusy(false); }
  };
  /* the composer clears the draft once this resolves, and keeps it when it throws */
  const say = async (body: string) => { setBusy(true); try { await api.postTicketComment(ticketId, body); setEnlarged(false); await reload(); } finally { setBusy(false); } };
  /* Escape in a field: with something typed it only leaves the field, empty it closes the card, as it does on the floor.
     It bubbles up from the composer's textarea; the mention menu, when open, has already taken it (defaultPrevented). */
  const escape = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const ta = e.target;
    if (e.key !== 'Escape' || e.defaultPrevented || !(ta instanceof HTMLTextAreaElement)) return;
    e.preventDefault(); if (ta.value) ta.blur(); else onClose();
  };

  const enlarge = (
    <button type="button" aria-pressed={enlarged} aria-label={enlarged ? 'Shrink the field' : 'Enlarge the field'}
      title={enlarged ? 'Shrink the field' : 'Enlarge the field: more room to write, the thread steps aside'}
      // Keep the caret in the field: enlarging must not end the typing.
      onMouseDown={(e) => e.preventDefault()} onClick={() => setEnlarged((v) => !v)}
      className={cn('flex h-[36px] w-[28px] flex-shrink-0 items-center justify-center rounded-lg transition-colors hover:text-[var(--theme-accent)]',
        enlarged ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-muted)]')}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
        {enlarged ? <path d="M14 2l-4.5 4.5M9.5 2.5v4h4M2 14l4.5-4.5M6.5 13.5v-4h-4" /> : <path d="M9.5 6.5L14 2M10 2h4v4M6.5 9.5L2 14M2 10v4h4" />}
      </svg>
    </button>
  );
  const rows = enlarged ? PEEK_ROWS.enlarged : PEEK_ROWS.folded;

  return (
    <>
      <div data-testid="peek-reply" className="flex min-h-0 flex-[0_1_auto] flex-col gap-1.5 overflow-y-auto border-t border-[var(--theme-border)] p-2 pb-1" onKeyDown={escape}>
        {gate ? (
          <>
            <span className="text-[11px] font-semibold text-[var(--theme-warning)]">{gate.name || 'The gate'} waits for your decision</span>
            <Composer bare noSplit maxRows={rows} trailingExtra={enlarge} textareaRef={field} ticketId={ticketId} value={reason} onChange={setReason} onSend={noop}
              submitOn="none" showExecBar={false} showSend={false} placeholder="Reason (optional), kept in the thread: markdown, paste a screenshot" />
          </>
        ) : (
          <Composer bare noSplit maxRows={rows} trailingExtra={enlarge} textareaRef={field} ticketId={ticketId} value={draft} onChange={setDraft} onSend={say}
            posting={busy} showExecBar={false}
            placeholder={asked ? 'Answer: the station takes the ticket again' : 'Reply: markdown, @ to mention, paste a screenshot'} />
        )}
      </div>
      <div data-testid="peek-actions" className="flex flex-none flex-wrap items-center gap-1.5 px-2 pb-2 pt-1">
        {gate
          ? gate.outcomes.map((o, i) => <Button key={o} size="sm" variant={i === 0 ? 'primary' : 'secondary'} disabled={busy} onClick={() => act(() => store.resolve(ticketId, o, reason), () => setReason(''))}>{o}</Button>)
          : failed && <Button size="sm" disabled={busy} onClick={() => act(() => store.putBack(ticketId))}>Run again</Button>}
        <Button size="sm" variant={gate ? 'ghost' : 'primary'} className="ml-auto" onClick={onOpen} title="The whole ticket (also Enter, V, or a double-click)">Open</Button>
      </div>
    </>
  );
}
