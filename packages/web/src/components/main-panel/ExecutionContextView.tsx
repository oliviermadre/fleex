import { useMemo, useState, useCallback } from 'react';
import type { AgentEvent, ContextInjectionItem, ContextInjectionKind, ExecutionContextData } from '@fleex/shared';
import { useUIStore } from '../../stores/uiStore';
import { fetchTicketDeliverables } from '../../services/api';
import { ticketLink } from '../../notifications/links';
import { tint, tintClasses, type TintHue } from '../../lib/tints';
import { cn } from '../../lib/cn';

/**
 * Hue per injection kind, so a reader can tell retrieved knowledge from
 * scaffolding at a glance: green for what a memory engine chose to inject
 * (`ticket_summary`, `memory_snippet`), neutral gray for the boilerplate an
 * agent always receives.
 */
const KIND_HUE: Record<ContextInjectionKind, TintHue> = {
  ticket_header: 'gray',
  description: 'blue',
  comment: 'teal',
  deliverable: 'purple',
  epic: 'indigo',
  ticket_summary: 'green',
  memory_snippet: 'green',
  skill_instructions: 'orange',
  skill_arguments: 'orange',
  workflow_instructions: 'yellow',
  routine_brief: 'yellow',
  routine_repositories: 'gray',
  task_instruction: 'red',
};

const KIND_LABEL: Record<ContextInjectionKind, string> = {
  ticket_header: 'Ticket',
  description: 'Description',
  comment: 'Comment',
  deliverable: 'Deliverable',
  epic: 'Epic',
  ticket_summary: 'Ticket summary',
  memory_snippet: 'Memory',
  skill_instructions: 'Skill',
  skill_arguments: 'Skill args',
  workflow_instructions: 'Workflow step',
  routine_brief: 'Brief',
  routine_repositories: 'Repositories',
  task_instruction: 'Task',
};

/** Kinds a memory engine selected rather than the prompt always carrying. */
const RETRIEVED_KINDS = new Set<ContextInjectionKind>(['ticket_summary', 'memory_snippet']);

function formatChars(n: number): string {
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(1)}k chars`;
}

/** Rough token estimate. Four characters per token is the usual heuristic. */
function estimateTokens(chars: number): string {
  const tokens = Math.round(chars / 4);
  return tokens < 1000 ? `~${tokens} tok` : `~${(tokens / 1000).toFixed(1)}k tok`;
}

export function ExecutionContextView({ events }: { events: AgentEvent[] }) {
  const [view, setView] = useState<'pretty' | 'raw'>('pretty');

  const context = useMemo(() => {
    const event = events.find((e) => e.eventType === 'execution_context');
    return (event?.data as ExecutionContextData | undefined) ?? null;
  }, [events]);

  if (!context) {
    return (
      <div className="flex-1 min-w-0 flex items-center justify-center p-6 text-center text-xs text-[var(--theme-text-faint)] bg-[var(--theme-bg-primary)]">
        No context recorded for this execution — it ran before context capture existed,
        or its events have been pruned.
      </div>
    );
  }

  const totalChars = context.systemPromptRaw.length + context.userPromptRaw.length;

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--theme-bg-primary)]">
      {/* Toolbar: what was sent, and in which representation */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--theme-border)] flex-shrink-0">
        <div className="flex items-center gap-1 p-0.5 rounded bg-[var(--theme-bg-hover)]">
          {(['pretty', 'raw'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              className={cn(
                'px-2.5 py-1 text-[11px] font-semibold rounded cursor-pointer border-none capitalize transition-colors',
                view === mode
                  ? 'bg-[var(--theme-accent)] text-[var(--theme-bg-primary)]'
                  : 'bg-transparent text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]',
              )}
            >
              {mode}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-[10px] text-[var(--theme-text-faint)] font-mono">
          {formatChars(totalChars)} · {estimateTokens(totalChars)}
          {context.imageCount > 0 && ` · ${context.imageCount} image${context.imageCount > 1 ? 's' : ''}`}
          {context.memoryEngine && ` · ${context.memoryEngine} memory`}
        </span>
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4">
        {view === 'pretty'
          ? <PrettyView context={context} />
          : <RawView context={context} />}
      </div>
    </div>
  );
}

// ─── Pretty view: the prompt as an outline of its sources ───

function PrettyView({ context }: { context: ExecutionContextData }) {
  const sections = useMemo(() => {
    const bySection = new Map<string, ContextInjectionItem[]>();
    for (const item of context.manifest) {
      const list = bySection.get(item.section);
      if (list) list.push(item);
      else bySection.set(item.section, [item]);
    }
    return [...bySection.entries()];
  }, [context.manifest]);

  return (
    <div className="space-y-4">
      <SystemPromptCard systemPrompt={context.systemPromptRaw} />

      {context.shadowManifest && context.shadowManifest.length > 0 && (
        <ShadowComparison items={context.shadowManifest} injected={context.manifest} />
      )}

      {sections.length === 0 ? (
        <div className="text-xs text-[var(--theme-text-faint)]">
          This run declared no itemised context — see the raw view for the prompt as sent.
        </div>
      ) : (
        sections.map(([section, items]) => (
          <div key={section}>
            <div className="flex items-center gap-2 mb-1.5">
              <h4 className="text-[10px] uppercase tracking-wider font-semibold text-[var(--theme-text-muted)]">
                {section}
              </h4>
              <span className="text-[10px] text-[var(--theme-text-faint)]">
                {items.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {items.map((item, i) => (
                <InjectionCard key={`${item.sourceId ?? item.label}-${i}`} item={item} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function SystemPromptCard({ systemPrompt }: { systemPrompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const gray = tintClasses('gray');

  return (
    <div className={cn('rounded border p-2.5', gray.bg, gray.borderColor)}>
      <div className="flex items-center gap-2">
        <span className={cn('text-[10px] uppercase tracking-wider font-semibold', gray.text)}>
          System prompt
        </span>
        <span className="text-[10px] text-[var(--theme-text-faint)] font-mono">
          {formatChars(systemPrompt.length)}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-[var(--theme-accent)] hover:underline cursor-pointer bg-transparent border-none"
        >
          {expanded ? 'collapse' : 'show'}
        </button>
      </div>
      {expanded && (
        <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap break-words text-[var(--theme-text-secondary)] max-h-64 overflow-y-auto">
          {systemPrompt}
        </pre>
      )}
    </div>
  );
}

function InjectionCard({ item }: { item: ContextInjectionItem }) {
  const hue = KIND_HUE[item.kind] ?? 'gray';
  const classes = tintClasses(hue);
  const openDeliverableOverlay = useUIStore((s) => s.openDeliverableOverlay);
  const [opening, setOpening] = useState(false);

  const isRetrieved = RETRIEVED_KINDS.has(item.kind);

  /**
   * A card is only clickable when it can actually show something: a deliverable
   * opens in the reading overlay, anything ticket-anchored deep-links to its
   * ticket. Scaffolding has no source, so it stays inert rather than offering a
   * link that goes nowhere.
   */
  const canOpen = (item.sourceKind === 'deliverable' && item.ticketId && item.sourceId)
    || (item.kind === 'ticket_summary' && item.sourceId)
    || (item.sourceKind === 'ticket' && item.sourceId);

  const handleOpen = useCallback(async () => {
    if (item.sourceKind === 'deliverable' && item.ticketId && item.sourceId) {
      setOpening(true);
      try {
        const deliverables = await fetchTicketDeliverables(item.ticketId);
        const match = deliverables.find((d) => d.id === item.sourceId);
        if (match) openDeliverableOverlay(match);
      } catch {
        // The deliverable may have been deleted since the run; the card stays put.
      } finally {
        setOpening(false);
      }
      return;
    }
    const ticketId = item.kind === 'ticket_summary' ? item.sourceId : (item.sourceId ?? item.ticketId);
    if (ticketId) window.location.assign(ticketLink(ticketId));
  }, [item, openDeliverableOverlay]);

  return (
    <div
      onClick={canOpen ? handleOpen : undefined}
      className={cn(
        'rounded border px-2.5 py-2 transition-colors',
        classes.bg,
        classes.borderColor,
        canOpen && 'cursor-pointer hover:brightness-125',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn('text-[9px] uppercase tracking-wider font-semibold flex-shrink-0', classes.text)}>
          {KIND_LABEL[item.kind] ?? item.kind}
        </span>
        <span className="text-xs text-[var(--theme-text-primary)] truncate min-w-0 flex-1">
          {item.label}
        </span>
        {isRetrieved && item.score !== undefined && (
          <span className="text-[10px] font-mono text-[var(--theme-text-muted)] flex-shrink-0">
            score {item.score.toFixed(2)}
          </span>
        )}
        <span className="text-[10px] font-mono text-[var(--theme-text-faint)] flex-shrink-0">
          {formatChars(item.charCount)}
        </span>
        {canOpen && (
          <svg
            width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            className="text-[var(--theme-text-faint)] flex-shrink-0"
          >
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
          </svg>
        )}
      </div>
      {(item.provenance || item.imageCount || opening) && (
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--theme-text-faint)]">
          {item.provenance && <span className="truncate">{item.provenance}</span>}
          {item.imageCount ? <span>{item.imageCount} image{item.imageCount > 1 ? 's' : ''}</span> : null}
          {opening && <span>opening…</span>}
        </div>
      )}
    </div>
  );
}

/**
 * What the other engine would have retrieved for this same run.
 *
 * Shown only in shadow mode, and shown as a separate block rather than merged
 * into the sections above: the reason to look at it is to see the difference, so
 * anything that blurred "sent" and "would have been sent" would defeat it. Items
 * the real prompt also contains are marked, because the interesting part is what
 * only one of the two engines found.
 */
function ShadowComparison({
  items,
  injected,
}: {
  items: ContextInjectionItem[];
  injected: ContextInjectionItem[];
}) {
  const [open, setOpen] = useState(false);
  const injectedKeys = new Set(injected.map((item) => `${item.sourceKind}:${item.sourceId}`));
  const novel = items.filter((item) => !injectedKeys.has(`${item.sourceKind}:${item.sourceId}`));

  return (
    <div className="rounded border border-dashed border-[var(--theme-border)] px-3 py-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent text-left"
      >
        <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--theme-text-muted)]">
          Semantic engine — not injected
        </span>
        <span className={cn('rounded px-1.5 py-0.5 text-[10px]', tint('blue'))}>
          {novel.length} of {items.length} new
        </span>
        <div className="flex-1" />
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className={cn('text-[var(--theme-text-muted)] transition-transform', open && 'rotate-180')}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {!open && (
        <p className="mt-1 text-[11px] text-[var(--theme-text-muted)]">
          Shadow mode is on: this run used the current ranking, and this is what the semantic engine
          would have supplied instead.
        </p>
      )}

      {open && (
        <ul className="mt-2 space-y-1">
          {items.map((item, i) => {
            const alsoInjected = injectedKeys.has(`${item.sourceKind}:${item.sourceId}`);
            return (
              <li key={`${item.sourceId}:${i}`} className="flex items-baseline gap-2 text-[11px]">
                <span className={cn(
                  'shrink-0 font-mono text-[10px]',
                  alsoInjected ? 'text-[var(--theme-text-faint)]' : 'text-[var(--theme-accent)]',
                )}>
                  {alsoInjected ? '=' : '+'}
                </span>
                <span className="min-w-0">
                  <span className="text-[var(--theme-text-primary)]">{item.label}</span>
                  <span className="ml-1.5 text-[var(--theme-text-faint)]">{item.provenance}</span>
                  {typeof item.score === 'number' && item.score > 0 && (
                    <span className="ml-1.5 font-mono text-[10px] text-[var(--theme-text-faint)]">
                      {item.score.toFixed(2)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Raw view: the exact strings handed to the SDK ───

function RawView({ context }: { context: ExecutionContextData }) {
  return (
    <div className="space-y-4">
      <RawBlock label="System prompt" text={context.systemPromptRaw} />
      <RawBlock label="User prompt" text={context.userPromptRaw} />
    </div>
  );
}

function RawBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied — the text is selectable either way.
    }
  }, [text]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <h4 className="text-[10px] uppercase tracking-wider font-semibold text-[var(--theme-text-muted)]">
          {label}
        </h4>
        <span className="text-[10px] text-[var(--theme-text-faint)] font-mono">
          {formatChars(text.length)}
        </span>
        <div className="flex-1" />
        <button
          onClick={handleCopy}
          className="text-[10px] text-[var(--theme-accent)] hover:underline cursor-pointer bg-transparent border-none"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-[var(--theme-text-secondary)] p-2.5 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)]">
        {text || '(empty)'}
      </pre>
    </div>
  );
}
