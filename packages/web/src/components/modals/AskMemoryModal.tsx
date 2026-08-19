import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { linkifyCitations, sourceLabel } from '../markdown/citations';
import { useUIStore } from '../../stores/uiStore';
import { useTicketStore } from '../../stores/ticketStore';
import { askMemory, type MemoryAnswer, type MemorySnippetResult } from '../../services/api';
import { tint } from '../../lib/tints';
import { cn } from '../../lib/cn';

const REASONS: Record<string, string> = {
  no_results: 'Nothing indexed relates to this question.',
  synthesis_failed: 'Could not draft an answer from what was retrieved.',
  unavailable: 'Answering from memory is switched off in Settings › Memory.',
};

/**
 * One entry of the source list: a document, and every citation number pointing at
 * it.
 *
 * Grouped because retrieval returns up to two chunks per document, so a list built
 * one row per citation showed the same title twice and doubled the space the
 * sources take. The numbers stay individually addressable — they are what the
 * answer's brackets refer to — while the title is stated once.
 */
interface SourceGroup {
  key: string;
  numbers: number[];
  title: string;
  kind: string;
  ticketId: string | null;
}

function groupSources(sources: MemorySnippetResult[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  sources.forEach((snippet, i) => {
    const key = `${snippet.sourceKind}:${snippet.sourceId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.numbers.push(i + 1);
      return;
    }
    groups.set(key, {
      key,
      numbers: [i + 1],
      title: sourceLabel(snippet.title),
      kind: snippet.sourceKind.replace(/_/g, ' '),
      ticketId: snippet.ticketId ?? (snippet.sourceKind === 'ticket' ? snippet.sourceId : null),
    });
  });
  return [...groups.values()];
}

/**
 * A cited answer drawn from past work.
 *
 * Three things decide the layout. The answer is markdown and is rendered as such,
 * because a model writes `**bold**` and a reader should not have to. The panel is a
 * bounded column with one scrolling region, because an answer with a dozen sources
 * is taller than a screen. And the sources are a compact footer rather than half
 * the panel: they exist to be *checked*, which needs a line each, not a paragraph.
 *
 * Citations are clickable. An uncited answer about your own work is
 * indistinguishable from a guess, and a citation you cannot follow is barely
 * better — clicking `[3]` brings its source into view and flashes it.
 */
export function AskMemoryModal() {
  const question = useUIStore((s) => s.askMemoryQuestion);
  const close = useUIStore((s) => s.closeAskMemory);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const selectTicket = useTicketStore((s) => s.selectTicket);

  const [result, setResult] = useState<MemoryAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [flashed, setFlashed] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  const inputRef = useRef<HTMLInputElement>(null);

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
    // The input starts on what was asked, so a follow-up is an edit rather than a
    // retype — most of them are a narrowing of the same question.
    setDraft(question ?? '');
  }, [question, ask]);

  // Focused on open: the panel is somewhere you ask things, not only somewhere an
  // answer lands. Escape still closes it — the Modal listens in the capture phase.
  useEffect(() => {
    if (question !== null) requestAnimationFrame(() => inputRef.current?.focus());
  }, [question]);

  /**
   * Ask what is in the box.
   *
   * Routed through the store when the text changed, so the header and the panel
   * agree on what was asked. An unchanged question would not move that state, so it
   * is re-run directly — which is what the old "Ask again" did, kept for the case
   * where a retry is genuinely what you want.
   */
  const submit = useCallback(() => {
    const next = draft.trim();
    if (!next || loading) return;
    if (next === question) void ask(next);
    else useUIStore.getState().openAskMemory(next);
  }, [draft, loading, question, ask]);

  const groups = useMemo(() => groupSources(result?.sources ?? []), [result]);

  // Rendered once per answer: the citation rewrite walks the whole text.
  const answerMarkdown = useMemo(
    () => (result?.answer ? linkifyCitations(result.answer, result.sources.length) : ''),
    [result],
  );

  const handleCitation = useCallback((index: number) => {
    const row = rowRefs.current.get(index);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // A flash rather than a persistent selection: it answers "which one is that"
    // and then gets out of the way.
    const group = groups.find((g) => g.numbers.includes(index));
    setFlashed(group?.key ?? null);
    setTimeout(() => setFlashed(null), 1200);
  }, [groups]);

  const openSource = useCallback((ticketId: string) => {
    close();
    setActivePanel('tickets');
    selectTicket(ticketId);
  }, [close, setActivePanel, selectTicket]);

  return (
    <Modal
      open={question !== null}
      onClose={close}
      maxWidth="max-w-3xl"
      className="flex max-h-[85vh] flex-col overflow-hidden"
    >
      <div className="flex flex-shrink-0 items-baseline gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--theme-text-primary)]">
          {question}
        </h3>
        <span className={cn('flex-shrink-0 rounded px-1.5 py-0.5 text-[10px]', tint('orange'))}>
          one LLM call
        </span>
      </div>

      {/* The one scrolling region. Everything around it is fixed, so the panel
          cannot outgrow the viewport however long the answer runs. */}
      <div className="-mr-2 mt-3 min-h-0 flex-1 overflow-y-auto pr-2">
        {loading && (
          <p className="text-xs text-[var(--theme-text-muted)]">
            Reading what this workspace remembers…
          </p>
        )}

        {failed && <p className="text-xs text-[var(--theme-danger)]">Could not reach memory.</p>}

        {result && !result.answer && (
          <p className={cn('rounded px-3 py-2 text-xs', tint('yellow'))}>
            {REASONS[result.reason ?? ''] ?? 'No answer.'}
          </p>
        )}

        {result?.answer && (
          <MarkdownRenderer
            content={answerMarkdown}
            profile="doc"
            onToggleCheckbox={() => {}}
            onCitation={handleCitation}
          />
        )}
      </div>

      {groups.length > 0 && (
        <div className="mt-3 flex-shrink-0 border-t border-[var(--theme-border)] pt-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            {result!.sources.length} source{result!.sources.length > 1 ? 's' : ''}
          </span>
          {/* Capped and scrollable: a dozen sources must not push the answer off
              the screen, which is what they were doing. */}
          <ol className="mt-1 max-h-32 space-y-px overflow-y-auto">
            {groups.map((group) => (
              <li
                key={group.key}
                ref={(el) => {
                  for (const n of group.numbers) {
                    if (el) rowRefs.current.set(n, el);
                    else rowRefs.current.delete(n);
                  }
                }}
                className={cn(
                  'flex items-baseline gap-1.5 rounded px-1 py-0.5 transition-colors',
                  flashed === group.key && 'bg-[var(--theme-accent)]/15',
                )}
              >
                <span className="flex-shrink-0 font-mono text-[10px] text-[var(--theme-text-faint)]">
                  {group.numbers.map((n) => `[${n}]`).join('')}
                </span>
                {group.ticketId ? (
                  <button
                    type="button"
                    onClick={() => openSource(group.ticketId!)}
                    title={group.title}
                    className="min-w-0 flex-1 cursor-pointer truncate border-none bg-transparent p-0 text-left text-[11px] text-[var(--theme-accent)] hover:underline"
                  >
                    {group.title}
                  </button>
                ) : (
                  <span
                    title={group.title}
                    className="min-w-0 flex-1 truncate text-[11px] text-[var(--theme-text-secondary)]"
                  >
                    {group.title}
                  </span>
                )}
                <span className="flex-shrink-0 text-[10px] text-[var(--theme-text-faint)]">
                  {group.kind}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* An answer can end on a clarifying question, and a panel with no input made
          that a dead end: the only button re-ran the identical query. Asking again
          from here also saves reopening the palette for every follow-up. */}
      <div className="mt-3 flex flex-shrink-0 items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          disabled={loading}
          placeholder="Ask something else…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          className="min-w-0 flex-1 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] disabled:opacity-50"
        />
        <Button
          variant="secondary"
          disabled={loading || !draft.trim()}
          onClick={submit}
        >
          {loading ? 'Asking…' : 'Ask'}
        </Button>
        <Button variant="primary" onClick={close}>Close</Button>
      </div>
    </Modal>
  );
}
