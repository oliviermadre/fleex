/**
 * An agent's pending question rendered as an answerable card (SPEC §5). The
 * question is the agent's last comment on a task whose activity is `waiting`;
 * options are parsed from that comment (parseInlineOptions). Answering posts the
 * chosen option as a comment — the same thing typing it would do — so no mention
 * plumbing is needed. Once posted, the card shows the answered state until the
 * refetch turns it back into an ordinary comment.
 */
import { useState } from 'react';
import { cn } from '../../../lib/cn';
import { MessageMarkdown } from './MessageMarkdown';

interface Props {
  authorName: string;
  body: string;
  options: string[];
  onAnswer: (optionText: string) => void | Promise<void>;
}

export function InlineQuestion({ authorName, body, options, onAnswer }: Props) {
  const [answered, setAnswered] = useState<string | null>(null);

  return (
    <div className="flex gap-2">
      <div
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--tint-purple-bg)] text-[12px] text-[var(--tint-purple-text)]"
        aria-hidden
      >
        ⌬
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[11px] font-medium text-[var(--theme-text-secondary)]">{authorName || 'Agent'}</div>
        <div
          className={cn(
            'rounded-xl border px-3 py-2',
            answered
              ? 'border-[var(--theme-border)] bg-[var(--theme-bg-surface)]'
              : 'border-[var(--tint-yellow-border)] bg-[var(--tint-yellow-bg)]',
          )}
        >
          <div
            className={cn(
              'mb-1 text-[10px] font-semibold tracking-[0.08em]',
              answered ? 'text-[var(--theme-text-muted)]' : 'text-[var(--tint-yellow-text)]',
            )}
          >
            {answered ? `ANSWERED · ${answered}` : 'WAITING FOR YOUR CHOICE'}
          </div>
          <div className="min-w-0 overflow-hidden text-[13px] text-[var(--theme-text-primary)]">
            <MessageMarkdown body={body} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {options.map((opt, i) => {
              const isChosen = answered === opt;
              const primary = i === 0 && !answered;
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={!!answered}
                  onClick={() => {
                    setAnswered(opt);
                    void onAnswer(opt);
                  }}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors disabled:cursor-default',
                    isChosen
                      ? 'bg-[var(--tint-green-bg)] text-[var(--tint-green-text)]'
                      : primary
                        ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)]'
                        : 'border border-[var(--theme-border-input)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)] disabled:opacity-50',
                  )}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
