import { useState } from 'react';
import { ACTION_STATUSES } from '@fleex/shared';
import type { ActionRunMode, ActionStatus, ConditionalAction } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { tintText } from '../../../lib/tints';
import { STATUS_LABEL, statusDotClass, truncate } from '../../actions/actionStatus';
import { AiSuggestBar } from './AiSuggestBar';
import { useReorderableList } from './useReorderableList';
import { AI_TEXT, CODE_INPUT, RunModeToggle, SparkIcon, TEXT_INPUT, environmentLine } from './shared';
import { CommandBinaryWarning } from '../../actions/RunHintCard';

interface RuleListProps {
  rules: ConditionalAction[];
  onChange: (rules: ConditionalAction[]) => void;
  defaultCommand: string;
  probeCommand: string;
  label: string;
  aiAvailable: boolean;
  errors: Record<number, string | undefined>;
  /** The action's run mode — what a rule without its own inherits. */
  actionRunMode?: ActionRunMode;
}

/**
 * "Depending on the status" rules, evaluated top to bottom: the first rule
 * whose statuses include the current one decides the click; none matching
 * falls through to the default action, shown as the fixed last line.
 */
export function RuleList({ rules, onChange, defaultCommand, probeCommand, label, aiAvailable, errors, actionRunMode = 'background' }: RuleListProps) {
  const { rowProps, dropIndicator } = useReorderableList(rules, onChange, 'application/x-fleex-action-rule');
  const [aiOpen, setAiOpen] = useState<Record<string, boolean>>({});

  const patch = (id: string, change: Partial<ConditionalAction>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...change } : r)));
  const toggleWhen = (rule: ConditionalAction, s: ActionStatus) => {
    const when = rule.when ?? [];
    patch(rule.id, { when: when.includes(s) ? when.filter((x) => x !== s) : [...when, s] });
  };

  return (
    <div className="flex flex-col gap-2">
      {rules.map((rule, i) => {
        const edge = dropIndicator(rule.id);
        const mode = rule.runMode ?? actionRunMode;
        return (
          <div key={rule.id} {...rowProps(rule.id)} className="relative grid grid-cols-[14px_150px_14px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-2.5">
            {edge === 'top' && <span className="absolute -top-1 left-0 right-0 h-0.5 rounded bg-[var(--theme-accent)]" />}
            {edge === 'bottom' && <span className="absolute -bottom-1 left-0 right-0 h-0.5 rounded bg-[var(--theme-accent)]" />}
            <span className="cursor-grab pt-1 text-[var(--theme-text-faint)]" title="Drag to reorder: the first matching rule wins">⋮⋮</span>
            <div>
              <div className="mb-1 text-[11px] text-[var(--theme-text-muted)]">If the status is</div>
              <div className="flex flex-wrap gap-1">
                {ACTION_STATUSES.map((s) => {
                  const on = rule.when?.includes(s) ?? false;
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={on}
                      className={cn(
                        'flex h-[22px] items-center gap-1 rounded border px-1.5 text-[11px]',
                        on ? 'border-transparent bg-[var(--theme-border-input)] text-[var(--theme-text-primary)]' : 'border-[var(--theme-border-input)] text-[var(--theme-text-muted)]',
                      )}
                      onClick={() => toggleWhen(rule, s)}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', statusDotClass(s))} /> {STATUS_LABEL[s]}
                    </button>
                  );
                })}
              </div>
            </div>
            <span className="pt-6 text-[var(--theme-text-faint)]">→</span>
            <div className="flex flex-col gap-1.5">
              <input className={cn(TEXT_INPUT, 'h-7 text-xs')} placeholder="Label (shown in the tooltip)" aria-label={`Rule ${i + 1} label`} value={rule.label} onChange={(e) => patch(rule.id, { label: e.target.value })} />
              <textarea className={cn(CODE_INPUT, 'min-h-[34px] py-1.5')} rows={1} spellCheck={false} placeholder="command" aria-label={`Rule ${i + 1} command`} value={rule.actionValue} onChange={(e) => patch(rule.id, { actionValue: e.target.value })} />
              {rule.actionType === 'shell' && (
                <div className="flex flex-wrap items-center gap-2">
                  <RunModeToggle small label={`Rule ${i + 1} run mode`} value={mode} onChange={(runMode) => patch(rule.id, { runMode })} />
                  <span className="font-mono text-[10.5px] text-[var(--theme-text-muted)]">{environmentLine(mode, rule.timeoutSec)}</span>
                </div>
              )}
              {rule.actionType === 'shell' && (
                <CommandBinaryWarning command={rule.actionValue} onRunInTerminal={mode === 'terminal' ? undefined : () => patch(rule.id, { runMode: 'terminal' })} />
              )}
              {errors[i] && <p className={cn('text-[11px]', tintText('red'))}>{errors[i]}</p>}
              {aiAvailable && !aiOpen[rule.id] && (
                <button type="button" className={cn('self-start text-[11px] hover:underline', AI_TEXT)} onClick={() => setAiOpen((o) => ({ ...o, [rule.id]: true }))}>
                  <SparkIcon size={10} className="mr-1 inline" />Describe in plain language
                </button>
              )}
              {aiAvailable && aiOpen[rule.id] && (
                <AiSuggestBar
                  autoFocus
                  kind="rule"
                  scope="pinned"
                  context={{ label, defaultCommand, probeCommand, currentCommand: rule.actionValue || undefined }}
                  placeholder="e.g. “log me out of the cluster”"
                  onApply={(command, intent, runMode) => patch(rule.id, { actionValue: command, ...(runMode ? { runMode } : {}), ...(rule.label ? {} : { label: intent.charAt(0).toUpperCase() + intent.slice(1) }) })}
                />
              )}
            </div>
            <button type="button" className="pt-1 text-[var(--theme-text-faint)] hover:text-[var(--theme-text-primary)]" aria-label={`Delete rule ${i + 1}`} onClick={() => onChange(rules.filter((r) => r.id !== rule.id))}>
              ✕
            </button>
          </div>
        );
      })}
      <div className="grid grid-cols-[14px_150px_14px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-dashed border-[var(--theme-border)] p-2.5">
        <span />
        <span className="text-[11px] text-[var(--theme-text-muted)]">Otherwise (no rule matches)</span>
        <span className="text-[var(--theme-text-faint)]">→</span>
        <span className="text-xs text-[var(--theme-text-secondary)]">
          Default action <code className="font-mono text-[11px] text-[var(--theme-text-muted)]">{truncate(defaultCommand, 48)}</code>
        </span>
        <span />
      </div>
    </div>
  );
}
