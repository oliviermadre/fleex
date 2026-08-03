import { useEffect, useLayoutEffect, useState } from 'react';

import type { AgentEvent } from '@fleex/shared';

import { useStickToBottom } from '../../hooks/useStickToBottom';
import { cn } from '../../lib/cn';
import { tint, tintText, tintClasses } from '../../lib/tints';
import { useAgentEventStore } from '../../stores/agentEventStore';

const EMPTY_EVENTS: AgentEvent[] = [];

interface Props {
  executionId: string;
}

export function AgentEventStream({ executionId }: Props) {
  const events = useAgentEventStore((s) => s.eventsByExecution[executionId] ?? EMPTY_EVENTS);
  const loadEvents = useAgentEventStore((s) => s.loadEventsForExecution);
  const subscribeExecution = useAgentEventStore((s) => s.subscribeExecution);
  const unsubscribeExecution = useAgentEventStore((s) => s.unsubscribeExecution);
  const loadStatus = useAgentEventStore((s) => s.eventsLoadStatus[executionId]);
  const { containerRef, maybeStick } = useStickToBottom<HTMLDivElement>();

  useEffect(() => {
    loadEvents(executionId);
    subscribeExecution(executionId);
    return () => {
      unsubscribeExecution(executionId);
    };
  }, [executionId, loadEvents, subscribeExecution, unsubscribeExecution]);

  // Follow new events only when the user is already at the bottom; if they
  // scrolled up to read a step, stay put (no re-scroll on each new line).
  useLayoutEffect(() => {
    maybeStick();
  }, [events.length, maybeStick]);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 font-mono text-sm bg-[var(--theme-bg-primary)]"
    >
      {events.length === 0 ? (
        <div className="flex items-center justify-center h-full text-[var(--theme-text-faint)]">
          {loadStatus === 'loading' || !loadStatus
            ? 'Loading events...'
            : loadStatus === 'error'
              ? 'Failed to load event history — execution may have run on another gateway'
              : 'Event history unavailable — may have been pruned or executed on another gateway'}
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event, i) => (
            <EventBlock key={event.id ?? i} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components for content_block_delta rendering ───

function CollapsibleText({
  text,
  previewLength = 120,
  className,
  label,
}: {
  text: string;
  previewLength?: number;
  className?: string;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsCollapse = text.length > previewLength;

  return (
    <div className={className}>
      {label && (
        <span className="text-[10px] uppercase tracking-wider opacity-60 mr-1">{label}</span>
      )}
      <span className="whitespace-pre-wrap break-words">
        {expanded || !needsCollapse ? text : text.slice(0, previewLength) + '…'}
      </span>
      {needsCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-1 text-[10px] text-[var(--theme-accent)] hover:underline cursor-pointer"
        >
          {expanded ? 'collapse' : 'expand'}
        </button>
      )}
    </div>
  );
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  return (
    <CollapsibleText
      text={thinking}
      previewLength={120}
      className={cn(
        'text-xs pl-2 border-l-2',
        tintText('purple'),
        tintClasses('purple').borderColor,
      )}
      label="thinking"
    />
  );
}

function TextBlock({ text }: { text: string }) {
  return (
    <div className="text-[var(--theme-text-primary)] whitespace-pre-wrap break-words">{text}</div>
  );
}

function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Bash':
      return (input.command as string) ?? '';
    case 'Read':
      return (input.file_path as string) ?? '';
    case 'Write':
      return (input.file_path as string) ?? '';
    case 'Edit':
      return (input.file_path as string) ?? '';
    case 'Grep':
      return `/${(input.pattern as string) ?? ''}/ ${(input.path as string) ?? ''}`;
    case 'Glob':
      return `${(input.pattern as string) ?? ''} ${(input.path as string) ?? ''}`.trim();
    case 'Task':
      return (input.description as string) ?? (input.prompt as string)?.slice(0, 80) ?? '';
    case 'WebFetch':
      return (input.url as string) ?? '';
    case 'WebSearch':
      return (input.query as string) ?? '';
    default: {
      const keys = Object.keys(input);
      if (keys.length === 0) return '';
      const first = input[keys[0]!];
      return typeof first === 'string' ? first.slice(0, 100) : JSON.stringify(first).slice(0, 100);
    }
  }
}

const TOOL_COLORS: Record<string, string> = {
  Bash: cn(tintClasses('yellow').bg, tintText('yellow')),
  Read: cn(tintClasses('blue').bg, tintText('blue')),
  Write: cn(tintClasses('green').bg, tintText('green')),
  Edit: cn(tintClasses('green').bg, tintText('green')),
  Grep: cn(tintClasses('purple').bg, tintText('purple')),
  Glob: cn(tintClasses('purple').bg, tintText('purple')),
  Task: cn(tintClasses('orange').bg, tintText('orange')),
  WebFetch: cn(tintClasses('teal').bg, tintText('teal')),
  WebSearch: cn(tintClasses('teal').bg, tintText('teal')),
};

function ToolCallBlock({ name, input }: { name: string; input: Record<string, unknown> }) {
  const summary = summarizeToolInput(name, input);
  const colorClass = TOOL_COLORS[name] ?? cn(tintClasses('gray').bg, tintText('gray'));

  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={cn('shrink-0 px-1.5 py-0.5 rounded text-[11px] font-semibold', colorClass)}>
        {name}
      </span>
      {summary && (
        <span className="text-[var(--theme-text-secondary)] break-all whitespace-pre-wrap truncate max-w-full">
          {summary.length > 200 ? summary.slice(0, 200) + '…' : summary}
        </span>
      )}
    </div>
  );
}

function ToolResultBlock({ content }: { content: unknown }) {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((c: { text?: string }) => c.text ?? '').join('\n')
        : JSON.stringify(content);

  return (
    <CollapsibleText
      text={text}
      previewLength={200}
      className={cn(
        'text-xs text-[var(--theme-text-faint)] pl-2 border-l-2',
        tintClasses('gray').borderColor,
      )}
      label="result"
    />
  );
}

type ContentBlock = {
  type: string;
  thinking?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
};

function AssistantMessageBlock({ content }: { content: ContentBlock[] }) {
  return (
    <div className="space-y-1.5">
      {content.map((block, i) => {
        switch (block.type) {
          case 'thinking':
            return block.thinking ? <ThinkingBlock key={i} thinking={block.thinking} /> : null;
          case 'text':
            return block.text ? <TextBlock key={i} text={block.text} /> : null;
          case 'tool_use':
            return block.name ? (
              <ToolCallBlock key={i} name={block.name} input={block.input ?? {}} />
            ) : null;
          default:
            return null;
        }
      })}
    </div>
  );
}

function UserMessageBlock({ content }: { content: ContentBlock[] }) {
  return (
    <div className="space-y-1">
      {content.map((block, i) => {
        if (block.type === 'tool_result') {
          return <ToolResultBlock key={i} content={block.content} />;
        }
        return null;
      })}
    </div>
  );
}

function SystemEventBlock({ data }: { data: Record<string, unknown> }) {
  const subtype = (data.subtype as string) ?? '';
  const description = (data.description as string) ?? '';

  return (
    <div className="flex items-center gap-2 text-xs text-[var(--theme-text-faint)]">
      <span className={tintText('blue')}>⚙</span>
      <span className="font-medium">{subtype}</span>
      {description && <span className="opacity-70">— {description}</span>}
    </div>
  );
}

// ─── Main EventBlock ───

function EventBlock({ event }: { event: AgentEvent }) {
  const data = event.data as Record<string, unknown> | null;

  switch (event.eventType) {
    case 'execution_start': {
      const personaName = (data?.['personaName'] as string) ?? 'Agent';
      const model = (data?.['model'] as string) ?? '';
      const execId = (data?.['executionId'] as string) ?? '';
      const effectiveMode = data?.['effectiveMode'] as string | undefined;
      const resumeSessionId = data?.['resumeSessionId'] as string | null;
      const sdkSessionId = data?.['sdkSessionId'] as string | null; // backfilled for old events
      const ctx = data?.['context'] as Record<string, unknown> | undefined;
      const label = data?.['label'] as string | undefined;
      const startMaxTurns = data?.['maxTurns'] as number | undefined;
      const modeBadge =
        effectiveMode === 'talk'
          ? '🗣 talk'
          : effectiveMode === 'plan'
            ? '📋 plan'
            : effectiveMode === 'edit'
              ? '📝 edit'
              : null;
      return (
        <div className="py-1 space-y-1">
          <div className="flex items-center gap-2 text-[var(--theme-accent)]">
            <span className="font-bold">▶ Execution started</span>
            <span className="text-xs text-[var(--theme-text-secondary)]">
              {personaName} ({model})
            </span>
            {modeBadge && (
              <span className="rounded-full bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-secondary)]">
                {modeBadge}
              </span>
            )}
            {label && (
              <span className="rounded-full bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-text-faint)]">
                {label}
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--theme-text-faint)] pl-4 space-y-0.5">
            {execId && (
              <div>
                <span className="text-[var(--theme-text-secondary)]">execution:</span>{' '}
                <span className="font-mono">{execId}</span>
              </div>
            )}
            {resumeSessionId && (
              <div>
                <span className="text-[var(--theme-text-secondary)]">resume:</span>{' '}
                <span className="font-mono">{resumeSessionId}</span>
              </div>
            )}
            {!resumeSessionId && sdkSessionId && (
              <div>
                <span className="text-[var(--theme-text-secondary)]">session:</span>{' '}
                <span className="font-mono">{sdkSessionId}</span>
              </div>
            )}
            {ctx && (
              <>
                <div>
                  <span className="text-[var(--theme-text-secondary)]">ticket:</span>{' '}
                  {ctx['ticketTitle'] as string} ({ctx['ticketStatus'] as string}){' · '}
                  {ctx['commentsCount'] as number} comments
                  {' · '}
                  {ctx['deliverablesCount'] as number} deliverables
                </div>
                <div>
                  <span className="text-[var(--theme-text-secondary)]">context:</span>{' '}
                  {(ctx['systemPromptSections'] as string[])?.join(', ')}
                  {' · '}system {((ctx['systemPromptLength'] as number) / 1000).toFixed(1)}k chars
                  {' · '}user {((ctx['userPromptLength'] as number) / 1000).toFixed(1)}k chars
                </div>
              </>
            )}
            {startMaxTurns != null && (
              <div title="A turn is one user↔assistant round-trip, not one tool call: a single turn can bundle several parallel tool calls.">
                <span className="text-[var(--theme-text-secondary)]">turn budget:</span>{' '}
                {startMaxTurns} turns
              </div>
            )}
          </div>
        </div>
      );
    }
    case 'execution_end': {
      const status = (data?.['status'] as string) ?? 'unknown';
      const endMode = data?.['effectiveMode'] as string | undefined;
      const durationMs = data?.['durationMs'] as number | undefined;
      const costUsd = data?.['costUsd'] as number | undefined;
      const inputTokens = data?.['inputTokens'] as number | undefined;
      const outputTokens = data?.['outputTokens'] as number | undefined;
      const numTurns = data?.['numTurns'] as number | undefined;
      const endMaxTurns = data?.['maxTurns'] as number | undefined;
      const turnsExhausted = numTurns != null && endMaxTurns != null && numTurns >= endMaxTurns;
      const endModeBadge =
        endMode === 'talk' ? '🗣' : endMode === 'plan' ? '📋' : endMode === 'edit' ? '📝' : '';
      return (
        <div className="py-1 space-y-0.5">
          <div
            className={cn(
              'flex items-center gap-2 font-bold',
              status === 'completed' ? tintText('green') : tintText('red'),
            )}
          >
            {status === 'completed' ? '✓ Execution completed' : '✗ Execution failed'}
            {endModeBadge && (
              <span className="text-xs font-normal text-[var(--theme-text-faint)]">
                {endModeBadge}
              </span>
            )}
          </div>
          {(durationMs || costUsd || inputTokens || numTurns != null) && (
            <div className="text-[10px] text-[var(--theme-text-faint)] pl-4 flex gap-3">
              {durationMs != null && <span>{(durationMs / 1000).toFixed(1)}s</span>}
              {numTurns != null && (
                <span
                  className={cn(turnsExhausted && tintText('yellow'))}
                  title={
                    'Conversation turns consumed vs the configured budget. A turn is one ' +
                    'user↔assistant round-trip — a single turn can carry many parallel tool ' +
                    'calls, so the number of tool actions above is usually much higher.'
                  }
                >
                  {numTurns} turn{numTurns === 1 ? '' : 's'}
                  {endMaxTurns != null && ` / ${endMaxTurns}`}
                </span>
              )}
              {inputTokens != null && outputTokens != null && (
                <span>
                  {inputTokens.toLocaleString()}→{outputTokens.toLocaleString()} tokens
                </span>
              )}
              {costUsd != null && <span>${costUsd.toFixed(4)}</span>}
            </div>
          )}
        </div>
      );
    }
    case 'message_stop': {
      const result = (data?.['result'] as string) ?? '';
      if (!result) return null;
      return (
        <div className="py-2 px-3 rounded bg-[var(--theme-bg-secondary)] text-[var(--theme-text-primary)] whitespace-pre-wrap">
          {result}
        </div>
      );
    }
    case 'error': {
      const error = (data?.['error'] as string) ?? 'Unknown error';
      // Errors can carry multi-line CLI stderr — render it preformatted,
      // monospace and scrollable so the real reason is readable, not clipped.
      return (
        <div className={cn('py-2 px-3 rounded border', tint('red'))}>
          <div className="font-semibold mb-1">Error</div>
          <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-64 overflow-auto m-0">
            {error}
          </pre>
        </div>
      );
    }
    // Emitted once, on the SDK `init` message — it marks the session opening,
    // not each conversation turn. Labelling it "Turn started" made runs look
    // like they only ever used one turn; the real turn count lands on
    // `execution_end` as `turns: used / budget`.
    case 'turn_start':
      return (
        <div className="flex items-center gap-2 py-0.5 text-xs text-[var(--theme-text-faint)]">
          ── Session started ──
        </div>
      );
    case 'max_turns_reached': {
      const used = data?.['numTurns'] as number | undefined;
      const budget = data?.['maxTurns'] as number | undefined;
      return (
        <div className={cn('py-2 px-3 rounded border text-xs', tint('yellow'))}>
          <span className="font-semibold">⚠ Turn budget exhausted</span>
          {' — '}
          the agent was stopped after {used ?? budget ?? '?'} turn{used === 1 ? '' : 's'}
          {budget != null && ` (max ${budget})`}, so its answer may be incomplete. Raise “Max Agent
          Turns” in Settings › General to let it run longer.
        </div>
      );
    }
    case 'content_block_delta': {
      if (!data) return null;
      const msgType = data['type'] as string;

      // Hide rate limit noise
      if (msgType === 'rate_limit_event') return null;

      // System events
      if (msgType === 'system') {
        return <SystemEventBlock data={data} />;
      }

      // Assistant messages with content blocks
      if (msgType === 'assistant') {
        const message = data['message'] as { content?: ContentBlock[] } | undefined;
        const content = message?.content;
        if (content && content.length > 0) {
          return <AssistantMessageBlock content={content} />;
        }
        return null;
      }

      // User messages (tool results)
      if (msgType === 'user') {
        const message = data['message'] as { content?: ContentBlock[] } | undefined;
        const content = message?.content;
        if (content && content.length > 0) {
          return <UserMessageBlock content={content} />;
        }
        return null;
      }

      // Fallback for unrecognized content_block_delta shapes
      return (
        <div className="text-xs text-[var(--theme-text-faint)] break-all whitespace-pre-wrap overflow-hidden">
          [{event.eventType}] {JSON.stringify(data).slice(0, 300)}
        </div>
      );
    }
    default:
      return <div className="text-xs text-[var(--theme-text-faint)]">[{event.eventType}]</div>;
  }
}
