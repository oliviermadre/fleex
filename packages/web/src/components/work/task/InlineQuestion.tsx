/**
 * An agent's pending question rendered as an answerable card (SPEC §5). The
 * question is the agent's last comment on a task whose activity is `waiting`,
 * and the choices are the `questions` the agent declared on it — never guessed
 * from the body. Answering posts a comment (formatQuestionAnswer), the same
 * thing typing it would do. Once posted, the card shows the answered state
 * until the refetch turns it back into an ordinary comment.
 */
import { useState } from 'react';
import type { AgentQuestion } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { MessageMarkdown } from './MessageMarkdown';
import { formatQuestionAnswer } from './questionAnswer';

interface Props {
  authorName: string;
  body: string;
  questions: AgentQuestion[];
  onAnswer: (text: string) => void | Promise<void>;
}

export function InlineQuestion({ authorName, body, questions, onAnswer }: Props) {
  const single = questions.length === 1;
  const [picks, setPicks] = useState<(string | null)[]>(() => questions.map(() => null));
  const [answered, setAnswered] = useState<string | null>(null);
  const complete = picks.every((p) => p !== null);

  const submit = (chosen: string[]) => {
    const text = formatQuestionAnswer(questions, chosen);
    setAnswered(single ? chosen[0]! : 'sent');
    void onAnswer(text);
  };

  const pick = (qi: number, opt: string) => {
    if (single) return submit([opt]);
    setPicks((prev) => prev.map((p, i) => (i === qi ? opt : p)));
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
          {questions.map((q, qi) => (
            <div key={`${qi}-${q.prompt}`} className="mt-2">
              <div className="mb-1 text-[11px] font-medium text-[var(--theme-text-secondary)]">{q.prompt}</div>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt, oi) => {
                  const isPicked = single ? answered === opt : picks[qi] === opt;
                  const primary = single && oi === 0 && !answered;
                  return (
                    <button
                      key={opt}
                      type="button"
                      aria-pressed={single ? undefined : isPicked}
                      disabled={!!answered}
                      onClick={() => pick(qi, opt)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors disabled:cursor-default',
                        isPicked
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
          ))}
          {!single && !answered && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                disabled={!complete}
                onClick={() => submit(picks as string[])}
                className="rounded-md bg-[var(--theme-accent)] px-2.5 py-1 text-[12px] font-medium text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)] disabled:cursor-default disabled:opacity-50"
              >
                Envoyer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
