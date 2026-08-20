import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { citedSources, linkifyCitations, sourceLabel } from '../markdown/citations';
import { useUIStore } from '../../stores/uiStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useAssistantStore } from '../../stores/assistantStore';
import { askMemoryStream, fetchDeliverable, type MemoryAnswer, type MemorySnippetResult } from '../../services/api';
import type { MemoryAskStage, Ticket } from '@fleex/shared';
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
  /** Display id of the ticket this came from, when it is not the ticket itself. */
  ticketRef: number | null;
  /**
   * Deliverable id to open directly, when there is no ticket behind it.
   *
   * A routine produces documents outside any ticket, and those rows used to be
   * inert text — worse, they ranked first, so the top of the list was the part
   * nothing could be done with.
   */
  deliverableId: string | null;
}

/**
 * @param ticketOf resolves a ticket id to the live ticket, for the reference and
 * for removing its title where the breadcrumb already repeats it.
 */
function groupSources(
  sources: MemorySnippetResult[],
  ticketOf: (id: string) => Ticket | null,
): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  sources.forEach((snippet, i) => {
    const key = `${snippet.sourceKind}:${snippet.sourceId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.numbers.push(i + 1);
      return;
    }

    const isTicket = snippet.sourceKind === 'ticket';
    const ticketId = snippet.ticketId ?? (isTicket ? snippet.sourceId : null);
    const ticket = ticketId ? ticketOf(ticketId) : null;

    groups.set(key, {
      key,
      numbers: [i + 1],
      title: sourceLabel(snippet.title, ticket?.title),
      kind: snippet.sourceKind.replace(/_/g, ' '),
      ticketId,
      // A ticket row does not need to point at itself.
      ticketRef: !isTicket && ticket ? ticket.displayId : null,
      deliverableId: !ticketId && snippet.sourceKind === 'deliverable' ? snippet.sourceId : null,
    });
  });
  return [...groups.values()];
}

/**
 * The answer, with its sources spelled out, ready to be someone else's history.
 *
 * The citations are numbers, and a number means nothing without the list it
 * points into. Carried verbatim into a conversation the answer would arrive full
 * of orphaned brackets, so the list travels with it — and it doubles as
 * something the assistant can act on, since it names the tickets and documents
 * involved.
 */
export function answerForHandoff(answer: string, sources: MemorySnippetResult[]): string {
  if (sources.length === 0) return answer;
  const listed = sources
    .map((s, i) => `[${i + 1}] ${sourceLabel(s.title)} (${s.sourceKind.replace(/_/g, ' ')})`)
    // One line per citation number, deduplicated on the text so the two chunks of
    // one document do not repeat its title.
    .filter((line, i, all) => all.indexOf(line) === i);
  return `${answer}\n\nSources:\n${listed.join('\n')}`;
}

/** What each stage is doing, in the reader's terms rather than the code's. */
function stageLabel(stage: MemoryAskStage): string {
  switch (stage.stage) {
    case 'encoding': return 'Encoding the question';
    case 'searching': return 'Searching what this workspace remembers';
    case 'retrieved':
      return `Found ${stage.passages} passage${stage.passages === 1 ? '' : 's'} `
        + `across ${stage.documents} document${stage.documents === 1 ? '' : 's'}`;
    case 'reading': return 'Reading the closest documents in full';
    case 'drafting': return 'Drafting the answer';
  }
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/**
 * What the wait is spending its time on.
 *
 * One frozen line for ten seconds of work read as nothing happening. Every stage
 * the server reports is kept on screen: the finished ones tick, the current one
 * pulses, and the documents found are named — which is the part that tells the
 * reader whether the answer coming is going to be any good.
 */
function StageProgress({ stages }: { stages: MemoryAskStage[] }) {
  // Seconds on the stage in progress. Retrieval finishes in well under one, but
  // drafting waits about ten before the model's first word — the SDK spawns a
  // subprocess — and a line that never changes for ten seconds is the thing that
  // looked broken. Held back for two seconds so the fast stages stay quiet.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [stages.length]);

  return (
    <ol className="space-y-1">
      {stages.map((stage, i) => {
        const current = i === stages.length - 1;
        return (
          <li key={`${stage.stage}-${i}`} className="flex items-baseline gap-2 text-xs">
            <span
              className={cn(
                'w-3 flex-shrink-0 translate-y-px',
                current ? 'animate-pulse text-[var(--theme-accent)]' : 'text-[var(--theme-success)]',
              )}
            >
              {current ? '·' : <CheckIcon />}
            </span>
            <span className="min-w-0">
              <span className={current ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-text-muted)]'}>
                {stageLabel(stage)}
              </span>
              {current && elapsed >= 2 && (
                <span className="ml-1.5 font-mono text-[10px] tabular-nums text-[var(--theme-text-faint)]">
                  {elapsed}s
                </span>
              )}
              {stage.stage === 'reading' && (
                <ul className="mt-0.5 space-y-px">
                  {stage.titles.map((title) => (
                    <li key={title} className="truncate text-[11px] text-[var(--theme-text-faint)]">
                      {sourceLabel(title)}
                    </li>
                  ))}
                </ul>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

interface SourceRowProps {
  group: SourceGroup;
  flashed: boolean;
  register: (el: HTMLLIElement | null) => void;
  onOpenTicket: (ticketId: string) => void;
  onOpenDocument: (deliverableId: string) => void;
}

/** One line of the source list: its numbers, what it is, and how to open it. */
function SourceRow({ group, flashed, register, onOpenTicket, onOpenDocument }: SourceRowProps) {
  const open = group.ticketId
    ? () => onOpenTicket(group.ticketId!)
    : group.deliverableId
      ? () => onOpenDocument(group.deliverableId!)
      : null;

  return (
    <li
      ref={register}
      className={cn(
        'flex items-baseline gap-1.5 rounded px-1 py-0.5 transition-colors',
        flashed && 'bg-[var(--theme-accent)]/15',
      )}
    >
      <span className="flex-shrink-0 font-mono text-[10px] text-[var(--theme-text-faint)]">
        {group.numbers.map((n) => `[${n}]`).join('')}
      </span>
      {open ? (
        <button
          type="button"
          onClick={open}
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
      {group.ticketRef !== null && (
        <button
          type="button"
          onClick={() => onOpenTicket(group.ticketId!)}
          title={`Open ticket #${group.ticketRef}`}
          className="flex-shrink-0 cursor-pointer rounded-sm border-none bg-[var(--theme-accent)]/12 px-1 font-mono text-[10px] text-[var(--theme-accent)] transition-colors hover:bg-[var(--theme-accent)]/25"
        >
          #{group.ticketRef}
        </button>
      )}
      <span className="flex-shrink-0 text-[10px] text-[var(--theme-text-faint)]">
        {group.kind}
      </span>
    </li>
  );
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
  const recordExchange = useAssistantStore((s) => s.recordExchange);
  const openSession = useAssistantStore((s) => s.openSession);

  /**
   * The assistant conversation this panel is writing into.
   *
   * Minted here rather than asked for, so the second question can be recorded
   * without waiting to hear about the first, and so a run of follow-ups lands in
   * one thread. One conversation per time the panel is opened: a later, unrelated
   * question deserves its own.
   */
  const conversationId = useRef(crypto.randomUUID());

  const [result, setResult] = useState<MemoryAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  // The message, not a boolean: a timeout says the encoder may still be loading,
  // which is actionable, and "Could not reach memory" threw that away.
  const [failure, setFailure] = useState<string | null>(null);
  const [flashed, setFlashed] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showOthers, setShowOthers] = useState(false);
  const [stages, setStages] = useState<MemoryAskStage[]>([]);
  // The answer as it is written. Retrieval takes under a second and the model
  // thirteen, so this is where nearly all of the wait actually happens.
  const [partial, setPartial] = useState('');

  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  const inputRef = useRef<HTMLInputElement>(null);

  const ask = useCallback(async (q: string) => {
    setLoading(true);
    setFailure(null);
    setResult(null);
    setShowOthers(false);
    setStages([]);
    setPartial('');
    try {
      const answered = await askMemoryStream(
        q,
        (stage) => setStages((s) => [...s, stage]),
        (delta) => setPartial((text) => text + delta),
      );
      setResult(answered);
      // Every answer is kept, so asking something is never a thing you lose. A
      // refusal is not: there is no exchange to file, only a question that found
      // nothing.
      if (answered.answer) {
        recordExchange(conversationId.current, q, answerForHandoff(answered.answer, answered.sources));
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not reach memory.');
    } finally {
      setLoading(false);
    }
  }, [recordExchange]);

  // A fresh panel is a fresh thread; follow-ups within it keep the same one.
  const opened = question !== null;
  useEffect(() => {
    if (opened) conversationId.current = crypto.randomUUID();
  }, [opened]);

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
  /**
   * Open the conversation this panel has been writing into.
   *
   * Nothing is transferred here — every exchange was already recorded as it
   * happened. This only goes and stands where the history is, which is also where
   * the whole fleex tool surface lives: a follow-up there can go back to the index
   * rather than only re-reading what was already retrieved.
   */
  const continueInAssistant = useCallback(() => {
    openSession(conversationId.current);
    close();
    setActivePanel('assistant');
  }, [openSession, close, setActivePanel]);

  /**
   * Ask what is in the box.
   *
   * Stays in this panel. A follow-up here is still a memory question, and the
   * assistant gets it either way — the conversation is being written as we go,
   * under one id, so the thread there mirrors this one.
   */
  const submit = useCallback(() => {
    const next = draft.trim();
    if (!next || loading) return;
    if (next === question) void ask(next);
    else useUIStore.getState().openAskMemory(next);
  }, [draft, loading, question, ask]);

  // Read from the live store: a deliverable knows the id of its ticket, and the
  // reader wants its number.
  const tickets = useTicketStore((s) => s.tickets);
  const groups = useMemo(
    () => groupSources(result?.sources ?? [], (id) => tickets.find((t) => t.id === id) ?? null),
    [result, tickets],
  );

  // Rendered once per answer: the citation rewrite walks the whole text.
  const answerMarkdown = useMemo(
    () => (result?.answer ? linkifyCitations(result.answer, result.sources.length) : ''),
    [result],
  );

  /**
   * The evidence, and everything else that was considered.
   *
   * Retrieval hands the model far more than it uses — four of eighteen, on the
   * question that prompted this — and one flat list made the part worth checking
   * indistinguishable from the part that was passed over. Nothing is hidden: the
   * rest is one click away and still counted in the header.
   */
  const [cited, others] = useMemo(() => {
    const numbers = citedSources(result?.answer ?? '', result?.sources.length ?? 0);
    const used = groups.filter((g) => g.numbers.some((n) => numbers.has(n)));
    return [used, groups.filter((g) => !used.includes(g))];
  }, [groups, result]);

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

  /**
   * Open a document that belongs to no ticket, in the reading overlay.
   *
   * Fetched on click rather than up front: most sources have a ticket, and
   * pre-loading a document nobody opens would spend a request per row.
   */
  const openDocument = useCallback(async (deliverableId: string) => {
    try {
      const deliverable = await fetchDeliverable(deliverableId);
      close();
      useUIStore.getState().openDeliverableOverlay(deliverable);
    } catch {
      setFailure('That document could no longer be found.');
    }
  }, [close]);

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
        {/* Once text starts arriving it takes over: the stages describe a second
            of work, the writing is the other thirteen. Rendered as markdown while
            it grows, so the layout does not jump when it finishes. */}
        {loading && partial && (
          <MarkdownRenderer content={partial} profile="doc" onToggleCheckbox={() => {}} />
        )}

        {loading && !partial && (
          stages.length > 0
            ? <StageProgress stages={stages} />
            // A flash before the first stage lands, and deliberately not the
            // button's word: two "Asking…" on one panel says less than one.
            : <p className="text-xs text-[var(--theme-text-muted)]">Starting…</p>
        )}

        {failure && <p className="text-xs text-[var(--theme-danger)]">{failure}</p>}

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

      {groups.length > 0 && (() => {
        // With no citations to go by — a refusal, or an answer that cited nothing —
        // every source is shown rather than none.
        const primary = cited.length > 0 ? cited : groups;
        const secondary = cited.length > 0 ? others : [];
        const register = (group: SourceGroup) => (el: HTMLLIElement | null) => {
          for (const n of group.numbers) {
            if (el) rowRefs.current.set(n, el);
            else rowRefs.current.delete(n);
          }
        };

        return (
          <div className="mt-3 flex-shrink-0 border-t border-[var(--theme-border)] pt-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
              {cited.length > 0
                ? `${primary.length} cited of ${groups.length} retrieved`
                : `${groups.length} retrieved`}
            </span>
            {/* Capped and scrollable: a dozen sources must not push the answer off
                the screen, which is what they were doing. */}
            <ol className="mt-1 max-h-32 space-y-px overflow-y-auto">
              {primary.map((group) => (
                <SourceRow
                  key={group.key}
                  group={group}
                  flashed={flashed === group.key}
                  register={register(group)}
                  onOpenTicket={openSource}
                  onOpenDocument={openDocument}
                />
              ))}
            </ol>

            {secondary.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowOthers((v) => !v)}
                  className="mt-1 cursor-pointer border-none bg-transparent p-0 text-[10px] text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)]"
                >
                  {showOthers ? 'Hide' : 'Show'} {secondary.length} retrieved but not cited
                </button>
                {showOthers && (
                  <ol className="mt-1 max-h-24 space-y-px overflow-y-auto opacity-60">
                    {secondary.map((group) => (
                      <SourceRow
                        key={group.key}
                        group={group}
                        flashed={flashed === group.key}
                        register={register(group)}
                        onOpenTicket={openSource}
                        onOpenDocument={openDocument}
                      />
                    ))}
                  </ol>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* An answer can end on a clarifying question, and a panel with no input made
          that a dead end: the only button re-ran the identical query. A second
          question is also the moment a lookup became a conversation, which is why
          it continues in the assistant rather than replacing the answer here. */}
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
        {/* Not a hand-off — the exchanges are already there. This goes and stands
            where the history is, and where the tools are. */}
        {result?.answer && (
          <Button variant="secondary" onClick={continueInAssistant}>
            Continue in Assistant
          </Button>
        )}
        <Button variant="primary" onClick={close}>Close</Button>
      </div>
    </Modal>
  );
}
