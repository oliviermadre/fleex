import { memo } from 'react';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { type AssistantChatItem, type AssistantToolStatus } from '../../stores/assistantStore';
import { cn } from '../../lib/cn';
import { tint, tintText } from '../../lib/tints';

/**
 * Read-only transcript of the active conversation (#518).
 *
 * WHY this is a separate memoized component: the composer's draft used to live
 * in the same component as this list, so every keystroke re-rendered every
 * message — and with it `parseSegments` + highlight.js on the full markdown of
 * the whole conversation. Cost was O(conversation length) × O(keystrokes).
 * Keep the draft out of this subtree, and keep every prop here referentially
 * stable, or the regression comes straight back.
 */

/**
 * Module-level constant on purpose: an inline `() => {}` creates a new
 * reference on every render, which silently defeats `memo(MarkdownRenderer)`.
 * The assistant transcript is not editable, so there is nothing to toggle.
 */
const NOOP_TOGGLE = () => {};

const TOOL_BADGE: Record<AssistantToolStatus, { label: string; className: string }> = {
  running: { label: '⏳ running', className: tintText('yellow') },
  ok: { label: '✓ ok', className: tintText('green') },
  fail: { label: '✗ failed', className: tintText('red') },
  denied: { label: '⊘ denied', className: tintText('gray') },
};

const AssistantMessage = memo(function AssistantMessage({ item }: { item: AssistantChatItem }) {
  if (item.kind === 'user') {
    return (
      <div className="ml-12 rounded-xl bg-[var(--theme-accent)]/10 px-4 py-3 text-sm">
        <MarkdownRenderer content={item.text} onToggleCheckbox={NOOP_TOGGLE} />
      </div>
    );
  }
  if (item.kind === 'assistant') {
    return (
      <div className="overflow-x-auto text-sm">
        <MarkdownRenderer content={item.text} onToggleCheckbox={NOOP_TOGGLE} />
      </div>
    );
  }
  const badge = TOOL_BADGE[item.status];
  return (
    <details className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2">
      <summary className="cursor-pointer font-mono text-[11px]">
        {item.autoApproved && (
          <span className={cn('mr-1', tintText('yellow'))} title="Auto-approuvé">
            ⚡
          </span>
        )}
        <span className={cn('mr-2', badge.className)}>{badge.label}</span>
        <span className="break-all text-[var(--theme-text-secondary)]">fleex {item.argv.join(' ')}</span>
      </summary>
      {item.text && (
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--theme-bg-overlay)] p-2 text-[10px] leading-relaxed text-[var(--theme-text-secondary)]">
          {item.text}
        </pre>
      )}
    </details>
  );
});

interface AssistantTranscriptProps {
  items: AssistantChatItem[];
  busy: boolean;
  /** Shown while busy — what the assistant is waiting on. */
  statusLabel: string;
  errorMsg: string | null;
}

export const AssistantTranscript = memo(function AssistantTranscript({
  items,
  busy,
  statusLabel,
  errorMsg,
}: AssistantTranscriptProps) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {items.map((item, i) => (
        <AssistantMessage key={item.kind === 'tool' && item.id ? item.id : i} item={item} />
      ))}
      {busy && <p className="animate-pulse text-xs text-[var(--theme-text-faint)]">{statusLabel}</p>}
      {errorMsg && <p className={cn('rounded-lg p-2.5 text-xs', tint('red'))}>{errorMsg}</p>}
    </div>
  );
});
