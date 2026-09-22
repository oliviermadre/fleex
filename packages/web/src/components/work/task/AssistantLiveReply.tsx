/**
 * The assistant's answer as it streams: the text deltas of its running execution,
 * rendered as a live ◆ bubble at the bottom of the stream. Disappears when the
 * turn ends (the posted comment takes over). Deltas reach the agent-event store
 * through the ticket subscription TaskPane already holds; the initial load
 * catches up after a reload mid-turn.
 */
import { useEffect, useMemo } from 'react';
import type { AgentExecution } from '@fleex/shared';
import { useAgentEventStore } from '../../../stores/agentEventStore';
import { MessageMarkdown } from './MessageMarkdown';

/** Concatenates the streamed text blocks of the assistant's deltas. Exported for tests. */
export function liveTextOf(events: readonly { eventType: string; data: unknown }[]): string {
  let out = '';
  for (const e of events) {
    if (e.eventType !== 'content_block_delta') continue;
    const d = e.data as { type?: string; message?: { content?: Array<{ type?: string; text?: string }> } } | null;
    if (d?.type !== 'assistant') continue;
    for (const b of d.message?.content ?? []) if (b.type === 'text' && typeof b.text === 'string') out += b.text;
  }
  return out;
}

export function AssistantLiveReply({ execution, name }: { execution: AgentExecution; name: string }) {
  const events = useAgentEventStore((s) => s.eventsByExecution[execution.id]);
  const loadEvents = useAgentEventStore((s) => s.loadEventsForExecution);
  useEffect(() => {
    void loadEvents(execution.id);
  }, [execution.id, loadEvents]);
  const text = useMemo(() => liveTextOf(events ?? []), [events]);

  return (
    <div className="flex gap-2">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--theme-accent-muted)] text-[12px] text-[var(--theme-accent)]" aria-hidden>◆</div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[11px] font-medium text-[var(--theme-text-secondary)]">{name}</div>
        {text ? (
          <div className="min-w-0 max-w-full overflow-hidden text-[13px] text-[var(--theme-text-primary)]">
            <MessageMarkdown body={text} />
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--theme-accent)] align-middle" aria-hidden />
          </div>
        ) : (
          <div className="text-[12px] text-[var(--theme-text-muted)]">
            <span className="animate-pulse">…</span>
          </div>
        )}
      </div>
    </div>
  );
}
