import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useUIStore } from '../../stores/uiStore';
import { useTicketStore } from '../../stores/ticketStore';
import { askMemory, type MemoryAnswer } from '../../services/api';
import { tint } from '../../lib/tints';
import { cn } from '../../lib/cn';

const REASONS: Record<string, string> = {
  no_results: 'Nothing indexed relates to this question.',
  synthesis_failed: 'Could not draft an answer from what was retrieved.',
  unavailable: 'Answering from memory is switched off in Settings › Memory.',
};

/**
 * A cited answer drawn from past work.
 *
 * Opened from the command palette with the question already typed, because that
 * is where the question forms: someone reaches for ⌘K to find a thing, fails to
 * name it, and what they actually want is the answer rather than the document.
 *
 * The sources are numbered and clickable, and the answer cites them by number.
 * That is the whole point of the surface: an uncited answer about your own work is
 * indistinguishable from a guess, and this one is drawn from excerpts that can be
 * opened and checked.
 */
export function AskMemoryModal() {
  const question = useUIStore((s) => s.askMemoryQuestion);
  const close = useUIStore((s) => s.closeAskMemory);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const selectTicket = useTicketStore((s) => s.selectTicket);

  const [result, setResult] = useState<MemoryAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const ask = useCallback(async (q: string) => {
    setLoading(true);
    setFailed(false);
    setResult(null);
    try {
      setResult(await askMemory(q));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (question) void ask(question);
  }, [question, ask]);

  const openSource = (ticketId: string) => {
    close();
    setActivePanel('tickets');
    selectTicket(ticketId);
  };

  return (
    <Modal open={question !== null} onClose={close} maxWidth="max-w-2xl">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">{question}</h3>
        <div className="flex-1" />
        <span className={cn('rounded px-1.5 py-0.5 text-[10px]', tint('orange'))}>one LLM call</span>
      </div>

      {loading && (
        <p className="mt-4 text-xs text-[var(--theme-text-muted)]">Reading what this workspace remembers…</p>
      )}

      {failed && (
        <p className="mt-4 text-xs text-[var(--theme-danger)]">Could not reach memory.</p>
      )}

      {result && !result.answer && (
        <p className={cn('mt-4 rounded px-3 py-2 text-xs', tint('yellow'))}>
          {REASONS[result.reason ?? ''] ?? 'No answer.'}
        </p>
      )}

      {result?.answer && (
        <div className="mt-3 max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-5 text-[var(--theme-text-primary)]">
          {result.answer}
        </div>
      )}

      {result && result.sources.length > 0 && (
        <ol className="mt-3 space-y-1 border-t border-[var(--theme-border)] pt-2">
          {result.sources.map((snippet, i) => {
            const ticketId = snippet.ticketId
              ?? (snippet.sourceKind === 'ticket' ? snippet.sourceId : null);
            return (
              <li key={`${snippet.sourceKind}:${snippet.sourceId}:${i}`} className="text-[11px]">
                <span className="text-[var(--theme-text-faint)]">[{i + 1}]</span>{' '}
                {ticketId ? (
                  <button
                    type="button"
                    onClick={() => openSource(ticketId)}
                    className="cursor-pointer border-none bg-transparent p-0 text-left text-[var(--theme-accent)] hover:underline"
                  >
                    {snippet.title}
                  </button>
                ) : (
                  <span className="text-[var(--theme-text-muted)]">{snippet.title}</span>
                )}
                <span className="ml-1.5 text-[var(--theme-text-faint)]">
                  {snippet.sourceKind.replace(/_/g, ' ')}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-4 flex justify-end gap-2">
        {question && (
          <Button variant="secondary" disabled={loading} onClick={() => void ask(question)}>
            Ask again
          </Button>
        )}
        <Button variant="primary" onClick={close}>Close</Button>
      </div>
    </Modal>
  );
}
