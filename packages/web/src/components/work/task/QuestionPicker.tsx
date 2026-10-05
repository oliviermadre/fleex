/**
 * The closed questions an agent declared, as something to act on: one group of
 * options per question, plus "Autre…" for an answer of one's own. A single
 * question is answered in one click (or by typing then Enter); several are
 * picked group by group (a pick can be changed) and sent together. The answer
 * is the comment formatQuestionAnswer builds — the same thing typing it would
 * do — so every host (Tasks card, Focus detail) posts it through its usual path.
 */
import { useId, useState } from 'react';
import type { AgentQuestion } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { formatQuestionAnswer } from './questionAnswer';

interface Props {
  questions: AgentQuestion[];
  onSubmit: (text: string) => void;
  /** Locks every option once answered; the picks stay highlighted. */
  disabled?: boolean;
}

const CUSTOM_LABEL = 'Autre…';

/** A predefined option, or the free-text answer ("Autre…"). */
type Pick = { kind: 'option'; value: string } | { kind: 'custom' };

export function QuestionPicker({ questions, onSubmit, disabled = false }: Props) {
  const uid = useId();
  const single = questions.length === 1;
  const [picks, setPicks] = useState<(Pick | null)[]>(() => questions.map(() => null));
  // Typed text survives switching back to a predefined option, in case one comes back to it.
  const [texts, setTexts] = useState<string[]>(() => questions.map(() => ''));

  const answerOf = (qi: number): string | null => {
    const p = picks[qi];
    if (!p) return null;
    if (p.kind === 'option') return p.value;
    return texts[qi]!.trim() || null;
  };
  const answers = questions.map((_, qi) => answerOf(qi));
  const answered = answers.filter((a) => a !== null).length;
  const left = questions.length - answered;

  const setPick = (qi: number, next: Pick) => setPicks((prev) => prev.map((p, i) => (i === qi ? next : p)));

  const pickOption = (qi: number, opt: string) => {
    setPick(qi, { kind: 'option', value: opt });
    if (single) onSubmit(formatQuestionAnswer(questions, [opt]));
  };

  const submitCustom = (qi: number) => {
    const text = texts[qi]!.trim();
    if (single && text) onSubmit(formatQuestionAnswer(questions, [text]));
  };

  return (
    // A column whose question list is the only part that shrinks: in a height-capped host
    // (Focus detail) the header and the send button stay in view while the list scrolls.
    <div className="flex min-h-0 flex-col rounded-lg border border-[var(--tint-yellow-border)] bg-[var(--theme-bg-surface)] px-3 py-2.5">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--tint-yellow-text)]">
          À toi de trancher · {questions.length} question{single ? '' : 's'}
        </span>
        {!single && !disabled && (
          <span className="text-[11px] tabular-nums text-[var(--theme-text-muted)]">{answered}/{questions.length} répondues</span>
        )}
      </div>

      <ol className="-mr-1.5 grid min-h-0 gap-3 overflow-y-auto pr-1.5">
        {questions.map((q, qi) => {
          const p = picks[qi];
          const custom = p?.kind === 'custom';
          return (
            <li key={`${qi}-${q.prompt}`} className="flex gap-2">
              {!single && (
                <span
                  aria-hidden
                  className={cn(
                    'mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                    answers[qi] !== null
                      ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                      : 'border border-[var(--theme-border-input)] text-[var(--theme-text-secondary)]',
                  )}
                >
                  {qi + 1}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div id={`${uid}-${qi}`} className="mb-1.5 text-[13px] font-semibold text-[var(--theme-text-primary)]">{q.prompt}</div>
                <div
                  role={single ? undefined : 'radiogroup'}
                  aria-labelledby={single ? undefined : `${uid}-${qi}`}
                  className="flex flex-col items-start gap-1.5"
                >
                  {q.options.map((opt) => (
                    <Chip
                      key={opt}
                      radio={!single}
                      chosen={p?.kind === 'option' && p.value === opt}
                      disabled={disabled}
                      onClick={() => pickOption(qi, opt)}
                    >
                      {opt}
                    </Chip>
                  ))}
                  {/* "Autre…" and its field share one line: the field is the answer of that radio. */}
                  <div className="flex w-full items-center gap-1.5">
                    <Chip radio={!single} chosen={custom} dashed disabled={disabled} onClick={() => setPick(qi, { kind: 'custom' })}>
                      {CUSTOM_LABEL}
                    </Chip>
                    {custom && (
                      <input
                        autoFocus
                        value={texts[qi]}
                        disabled={disabled}
                        aria-label={`Réponse libre — ${q.prompt}`}
                        placeholder="Ta réponse à cette question…"
                        onChange={(e) => {
                          const v = e.target.value;
                          setTexts((prev) => prev.map((t, i) => (i === qi ? v : t)));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            submitCustom(qi);
                          }
                        }}
                        className="h-7 min-w-0 flex-1 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-2 text-[12.5px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none disabled:opacity-60"
                      />
                    )}
                    {custom && single && !disabled && (
                      <button
                        type="button"
                        disabled={!texts[qi]!.trim()}
                        onClick={() => submitCustom(qi)}
                        className="h-7 rounded-md bg-[var(--theme-accent)] px-2.5 text-[12px] font-semibold text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)] disabled:opacity-40"
                      >
                        Envoyer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {!single && !disabled && (
        <div className="mt-3 flex shrink-0 items-center justify-end gap-3">
          {left > 0 && <span className="text-[11.5px] text-[var(--theme-text-muted)]">Encore {left} à choisir</span>}
          <button
            type="button"
            disabled={left > 0}
            onClick={() => onSubmit(formatQuestionAnswer(questions, answers as string[]))}
            className="rounded-md bg-[var(--theme-accent)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)] disabled:cursor-default disabled:opacity-40"
          >
            Envoyer les {questions.length} réponses
          </button>
        </div>
      )}
    </div>
  );
}

function Chip({
  radio,
  chosen,
  dashed = false,
  disabled,
  onClick,
  children,
}: {
  radio: boolean;
  chosen: boolean;
  dashed?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? chosen : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-left text-[12.5px] font-medium transition-colors disabled:cursor-default',
        chosen
          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
          : cn(
              'bg-[var(--theme-bg-base)] text-[var(--theme-text-primary)] hover:border-[var(--theme-accent)] hover:bg-[var(--theme-bg-hover)] disabled:opacity-50 disabled:hover:border-[var(--theme-border-input)] disabled:hover:bg-[var(--theme-bg-base)]',
              dashed ? 'border-dashed border-[var(--theme-border-input)] text-[var(--theme-text-secondary)]' : 'border-[var(--theme-border-input)]',
            ),
      )}
    >
      {radio && (
        <span
          aria-hidden
          className={cn('h-2.5 w-2.5 shrink-0 rounded-full border', chosen ? 'border-current bg-current' : 'border-[var(--theme-text-muted)]')}
        />
      )}
      {children}
    </button>
  );
}
