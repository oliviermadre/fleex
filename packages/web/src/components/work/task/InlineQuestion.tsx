/**
 * An agent's pending question rendered as an answerable card (SPEC §5). The
 * question is the agent's last comment on a task whose activity is `waiting`,
 * and the choices are the `questions` the agent declared on it — never guessed
 * from the body. The message reads as usual; the choices sit below it in their
 * own action panel (QuestionPicker), whose answer is posted as a comment. Once
 * posted, the card shows the answered state until the refetch turns it back
 * into an ordinary comment.
 */
import { useState } from 'react';
import type { AgentQuestion } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { MessageMarkdown } from './MessageMarkdown';
import { QuestionPicker } from './QuestionPicker';

interface Props {
  authorName: string;
  body: string;
  questions: AgentQuestion[];
  onAnswer: (text: string) => void | Promise<void>;
}

export function InlineQuestion({ authorName, body, questions, onAnswer }: Props) {
  const single = questions.length === 1;
  const [answered, setAnswered] = useState<string | null>(null);

  const submit = (text: string) => {
    setAnswered(text);
    void onAnswer(text);
  };

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
            {answered ? (single ? `ANSWERED · ${answered}` : 'ANSWERED') : 'WAITING FOR YOUR CHOICE'}
          </div>
          <div className="min-w-0 overflow-hidden text-[13px] text-[var(--theme-text-primary)]">
            <MessageMarkdown body={body} />
          </div>
          <div className="mt-3">
            <QuestionPicker
              questions={questions}
              onSubmit={submit}
              disabled={!!answered}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

