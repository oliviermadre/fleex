import { useEffect, useRef, useState } from 'react';
import type { AgentEvent } from '@asm/shared';
import { useAgentEventStore } from '../../stores/agentEventStore';
import { cn } from '../../lib/cn';

const EMPTY_EVENTS: AgentEvent[] = [];

interface Props {
  executionId: string;
}

export function AgentEventStream({ executionId }: Props) {
  const events = useAgentEventStore((s) => s.eventsByExecution[executionId] ?? EMPTY_EVENTS);
  const loadEvents = useAgentEventStore((s) => s.loadEventsForExecution);
  const subscribeExecution = useAgentEventStore((s) => s.subscribeExecution);
  const unsubscribeExecution = useAgentEventStore((s) => s.unsubscribeExecution);
  const streaming = useAgentEventStore((s) => !!s.streamingExecutionIds[executionId]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadEvents(executionId);
    subscribeExecution(executionId);
    return () => {
      unsubscribeExecution(executionId);
    };
  }, [executionId, loadEvents, subscribeExecution, unsubscribeExecution]);

  // Auto-scroll during streaming
  useEffect(() => {
    if (streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, streaming]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 font-mono text-sm bg-[var(--theme-bg-primary)]"
    >
      {events.length === 0 ? (
        <div className="flex items-center justify-center h-full text-[var(--theme-text-faint)]">
          Loading events...
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
      className="text-xs text-violet-400/70 pl-2 border-l-2 border-violet-500/30"
      label="thinking"
    />
  );
}

function TextBlock({ text }: { text: string }) {
  return (
    <div className="text-[var(--theme-text-primary)] whitespace-pre-wrap break-words">
      {text}
    </div>
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
      return `/${input.pattern as string ?? ''}/ ${input.path as string ?? ''}`;
    case 'Glob':
      return `${input.pattern as string ?? ''} ${input.path as string ?? ''}`.trim();
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
  Bash: 'bg-amber-500/20 text-amber-300',
  Read: 'bg-sky-500/20 text-sky-300',
  Write: 'bg-emerald-500/20 text-emerald-300',
  Edit: 'bg-emerald-500/20 text-emerald-300',
  Grep: 'bg-purple-500/20 text-purple-300',
  Glob: 'bg-purple-500/20 text-purple-300',
  Task: 'bg-orange-500/20 text-orange-300',
  WebFetch: 'bg-cyan-500/20 text-cyan-300',
  WebSearch: 'bg-cyan-500/20 text-cyan-300',
};

function ToolCallBlock({ name, input }: { name: string; input: Record<string, unknown> }) {
  const summary = summarizeToolInput(name, input);
  const colorClass = TOOL_COLORS[name] ?? 'bg-zinc-500/20 text-zinc-300';

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
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((c: { text?: string }) => c.text ?? '').join('\n')
      : JSON.stringify(content);

  return (
    <CollapsibleText
      text={text}
      previewLength={200}
      className="text-xs text-[var(--theme-text-faint)] pl-2 border-l-2 border-zinc-500/30"
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
  const subtype = data.subtype as string ?? '';
  const description = data.description as string ?? '';

  return (
    <div className="flex items-center gap-2 text-xs text-[var(--theme-text-faint)]">
      <span className="text-blue-400">⚙</span>
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
      const personaName = data?.['personaName'] as string ?? 'Agent';
      const model = data?.['model'] as string ?? '';
      const execId = data?.['executionId'] as string ?? '';
      const resumeSessionId = data?.['resumeSessionId'] as string | null;
      const sdkSessionId = data?.['sdkSessionId'] as string | null; // backfilled for old events
      const ctx = data?.['context'] as Record<string, unknown> | undefined;
      return (
        <div className="py-1 space-y-1">
          <div className="flex items-center gap-2 text-[var(--theme-accent)]">
            <span className="font-bold">▶ Execution started</span>
            <span className="text-xs text-[var(--theme-text-secondary)]">
              {personaName} ({model})
            </span>
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
                  {ctx['ticketTitle'] as string} ({ctx['ticketStatus'] as string})
                  {' · '}{ctx['commentsCount'] as number} comments
                  {' · '}{ctx['deliverablesCount'] as number} deliverables
                </div>
                <div>
                  <span className="text-[var(--theme-text-secondary)]">context:</span>{' '}
                  {(ctx['systemPromptSections'] as string[])?.join(', ')}
                  {' · '}system {((ctx['systemPromptLength'] as number) / 1000).toFixed(1)}k chars
                  {' · '}user {((ctx['userPromptLength'] as number) / 1000).toFixed(1)}k chars
                </div>
              </>
            )}
          </div>
        </div>
      );
    }
    case 'execution_end': {
      const status = data?.['status'] as string ?? 'unknown';
      return (
        <div className={cn(
          'flex items-center gap-2 py-1 font-bold',
          status === 'completed' ? 'text-green-400' : 'text-red-400'
        )}>
          {status === 'completed' ? '✓ Execution completed' : '✗ Execution failed'}
        </div>
      );
    }
    case 'message_stop': {
      const result = data?.['result'] as string ?? '';
      if (!result) return null;
      return (
        <div className="py-2 px-3 rounded bg-[var(--theme-bg-secondary)] text-[var(--theme-text-primary)] whitespace-pre-wrap">
          {result}
        </div>
      );
    }
    case 'error': {
      const error = data?.['error'] as string ?? 'Unknown error';
      return (
        <div className="py-2 px-3 rounded bg-red-500/10 border border-red-500/30 text-red-400">
          Error: {error}
        </div>
      );
    }
    case 'turn_start':
      return (
        <div className="flex items-center gap-2 py-0.5 text-xs text-[var(--theme-text-faint)]">
          ── Turn started ──
        </div>
      );
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
      return (
        <div className="text-xs text-[var(--theme-text-faint)]">
          [{event.eventType}]
        </div>
      );
  }
}
