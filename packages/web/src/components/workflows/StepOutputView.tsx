import { useState } from 'react';
import Markdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import type { StepOutput, StepRunResult, TicketDeliverable } from '@fleex/shared';
import { userRemarkPlugins } from '../markdown/profiles';
import { useUIStore } from '../../stores/uiStore';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { tint } from '../../lib/tints';
import { cn } from '../../lib/cn';

// Module-level so the reference stays stable across renders.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rehypePlugins: any[] = [rehypeHighlight];

/**
 * The keys a step output always carries, whatever the step did. Everything an
 * output-format schema adds lands in `schemaFields`, so the pretty view can
 * render the known shape structurally and still show the custom fields — no
 * step type is ever reduced to "read the raw JSON".
 */
const RESULT_TINT: Record<StepRunResult, string> = {
  ok: tint('green'),
  needs_review: tint('yellow'),
  ko: tint('red'),
};

interface Props {
  output: StepOutput;
  /**
   * The persisted deliverable this very output produced, when it could be
   * matched. Present ⇒ the deliverable line opens the real reading overlay
   * instead of only showing the markdown the agent returned.
   */
  latestDeliverable?: TicketDeliverable | undefined;
}

/**
 * Step output, readable.
 *
 * The raw JSON is still one click away — an output-format schema can put
 * anything in `schemaFields`, and when the render is not what you expected the
 * bytes are the only ground truth. But `comment` is markdown, and markdown
 * escaped inside a JSON string is the single least readable way to show a
 * paragraph, so pretty is the default.
 */
export function StepOutputView({ output, latestDeliverable }: Props) {
  const [mode, setMode] = useState<'pretty' | 'raw'>('pretty');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Output
        </div>
        <div className="flex rounded border border-[var(--theme-border-input)] p-px">
          {(['pretty', 'raw'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] capitalize transition-colors',
                mode === m
                  ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]'
                  : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {mode === 'raw' ? (
        <pre className="overflow-x-auto rounded bg-[var(--theme-bg-overlay)] p-2 text-[10px] text-[var(--theme-text-primary)]">
          {JSON.stringify(output, null, 2)}
        </pre>
      ) : (
        <PrettyOutput output={output} latestDeliverable={latestDeliverable} />
      )}
    </div>
  );
}

function PrettyOutput({ output, latestDeliverable }: Props) {
  const schemaEntries = Object.entries(output.schemaFields ?? {});

  return (
    <div className="space-y-3">
      {/* Verdict line: what the engine read to decide where to go next. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', RESULT_TINT[output.result])}>
          {output.result}
        </span>
        {output.outcome && (
          <span className="rounded-full bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[10px] text-[var(--theme-text-secondary)]">
            outcome: {output.outcome}
          </span>
        )}
        {output.mentionStatus && (
          <span className="rounded-full bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[10px] text-[var(--theme-text-secondary)]">
            {output.mentionStatus}
          </span>
        )}
      </div>

      {/* The deliverable THIS attempt produced. Deliberately shown inside the
          output rather than in the deliverables box above: that box lists the
          previous attempts, and telling old from new is the whole point.

          The output is not the only way a step produces one: an agent can
          attach a deliverable to its own step run from the CLI, which is the
          recommended path for bulky content. Those runs return
          `deliverable: null`, so keying this section on the output alone hid a
          deliverable the graph was already showing on the node. When only the
          persisted row exists, it *is* the deliverable — render it from there. */}
      {output.deliverable ? (
        <Section label="Deliverable">
          <OutputDeliverable deliverable={output.deliverable} persisted={latestDeliverable} />
        </Section>
      ) : latestDeliverable ? (
        <Section label="Deliverable">
          <OutputDeliverable
            deliverable={{
              title: latestDeliverable.title,
              markdown: latestDeliverable.content,
              type: latestDeliverable.type,
              status: latestDeliverable.status,
            }}
            persisted={latestDeliverable}
          />
        </Section>
      ) : null}

      {output.comment && (
        <Section label="Comment">
          <div className="needs-review-markdown text-xs text-[var(--theme-text-primary)]">
            <Markdown remarkPlugins={userRemarkPlugins} rehypePlugins={rehypePlugins}>
              {output.comment}
            </Markdown>
          </div>
        </Section>
      )}

      {output.humanResponse && (
        <Section label="Human response">
          <div className="needs-review-markdown text-xs text-[var(--theme-text-primary)]">
            <Markdown remarkPlugins={userRemarkPlugins} rehypePlugins={rehypePlugins}>
              {output.humanResponse}
            </Markdown>
          </div>
        </Section>
      )}

      {output.routing && (
        <Section label="Routing">
          <dl className="space-y-1 text-xs text-[var(--theme-text-secondary)]">
            <FieldRow label="candidates" value={output.routing.candidateEdgeIds.join(', ')} />
            {output.routing.chosenEdgeId && <FieldRow label="chosen" value={output.routing.chosenEdgeId} />}
            {output.routing.decidedBy && <FieldRow label="decided by" value={output.routing.decidedBy} />}
            {output.routing.notes && <FieldRow label="notes" value={output.routing.notes} />}
          </dl>
        </Section>
      )}

      {schemaEntries.length > 0 && (
        <Section label="Fields">
          <dl className="space-y-1 text-xs text-[var(--theme-text-secondary)]">
            {schemaEntries.map(([key, value]) => (
              <FieldRow key={key} label={key} value={value} />
            ))}
          </dl>
        </Section>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]">
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * One `schemaFields` / routing entry. Scalars read as text; anything nested is
 * shown as JSON — that part genuinely has no better rendering, and a schema
 * field can be any shape the step author declared.
 */
function FieldRow({ label, value }: { label: string; value: unknown }) {
  const isScalar = value === null || ['string', 'number', 'boolean'].includes(typeof value);
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 font-mono text-[10px] text-[var(--theme-text-faint)]">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">
        {isScalar ? (
          <span className="whitespace-pre-wrap">{value === null ? '—' : String(value)}</span>
        ) : (
          <pre className="overflow-x-auto rounded bg-[var(--theme-bg-overlay)] p-1.5 text-[10px]">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </dd>
    </div>
  );
}

/**
 * The deliverable carried by the output. When the persisted row was matched we
 * open the shared reading overlay — same affordance as everywhere else; when it
 * was not (deliverable rejected, or run not yet persisted) the markdown is
 * expandable in place so the content is never lost.
 */
function OutputDeliverable({
  deliverable,
  persisted,
}: {
  deliverable: NonNullable<StepOutput['deliverable']>;
  persisted: TicketDeliverable | undefined;
}) {
  const openDeliverableOverlay = useUIStore((s) => s.openDeliverableOverlay);
  const labelForType = useDeliverableTypesStore((s) => s.labelFor);
  const colorForType = useDeliverableTypesStore((s) => s.colorFor);
  const [expanded, setExpanded] = useState(false);
  const c = colorForType(deliverable.type);

  return (
    <div className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
      <button
        type="button"
        onClick={() => (persisted ? openDeliverableOverlay(persisted) : setExpanded((v) => !v))}
        title={deliverable.title}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-[var(--theme-bg-hover)]"
      >
        <span
          className={cn(
            'shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
            c ? '' : 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]',
          )}
          style={c ? { backgroundColor: c.bg, color: c.text } : undefined}
        >
          {labelForType(deliverable.type)}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--theme-text-primary)]">
          {deliverable.title}
        </span>
        {deliverable.status === 'draft' && (
          <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium', tint('yellow'))}>
            draft
          </span>
        )}
        <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium', tint('green'))}>
          new
        </span>
      </button>
      {expanded && !persisted && (
        <div className="needs-review-markdown max-h-72 overflow-y-auto border-t border-[var(--theme-border)] px-2 py-2 text-xs text-[var(--theme-text-primary)]">
          <Markdown remarkPlugins={userRemarkPlugins} rehypePlugins={rehypePlugins}>
            {deliverable.markdown}
          </Markdown>
        </div>
      )}
    </div>
  );
}
