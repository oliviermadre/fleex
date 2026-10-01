import { useState } from 'react';
import type { ActionsAiCommandKind, ActionsAiCommandRequest, ActionsAiCommandSuggestion, CommandRisk } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { tint } from '../../../lib/tints';
import * as api from '../../../services/api';
import type { ActionsScope } from '../../../stores/uiStore';
import { Button } from '../../ui/Button';
import { AI_BUTTON, AI_TEXT, Chip, SparkIcon } from './shared';

const RISK: Record<CommandRisk, { label: string; className: string }> = {
  safe: { label: 'Read-only', className: tint('green') },
  mutating: { label: 'Changes state', className: tint('yellow') },
  destructive: { label: 'Destructive — check before saving', className: tint('red') },
};

interface AiSuggestBarProps {
  kind: ActionsAiCommandKind;
  scope: ActionsScope;
  context: ActionsAiCommandRequest['context'];
  placeholder: string;
  /** Receives the command and the intent (used as a rule label when it has none). */
  onApply: (command: string, intent: string) => void;
  autoFocus?: boolean;
}

/**
 * "Describe it, get the command": plain language in, one command out with an
 * explanation, a risk level and the binaries found on this machine, applied in
 * one click. It only fills the field — running stays the user's call.
 */
export function AiSuggestBar({ kind, scope, context, placeholder, onApply, autoFocus }: AiSuggestBarProps) {
  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ActionsAiCommandSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<string[]>([]);

  const suggest = async (another = false) => {
    const text = intent.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    try {
      const exclude = another && result ? [...seen, result.command] : [];
      const suggestion = await api.suggestActionCommand({ intent: text, kind, scope, context, ...(exclude.length ? { exclude } : {}) });
      setSeen(exclude);
      setResult(suggestion);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-2.5 flex flex-col gap-2">
      <div className={cn('flex items-center gap-2 rounded-lg border py-1 pl-2.5 pr-1', tint('purple'))}>
        <SparkIcon size={14} className="shrink-0" />
        <input
          autoFocus={autoFocus}
          className="h-7 flex-1 bg-transparent text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:outline-none"
          placeholder={placeholder}
          aria-label={placeholder}
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void suggest();
            }
          }}
        />
        <button type="button" className={AI_BUTTON} onClick={() => void suggest()} disabled={!intent.trim() || loading}>
          Suggest ⏎
        </button>
      </div>

      {loading && (
        <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs', tint('purple'))} role="status">
          <span className="animate-pulse">●●●</span> Haiku is thinking… <span className="text-[var(--theme-text-muted)]">and checking which tools you have</span>
        </div>
      )}
      {error && !loading && (
        <div className={cn('rounded-lg border px-3 py-2 text-xs', tint('red'))}>{error}</div>
      )}
      {result && !loading && (
        <div className="overflow-hidden rounded-lg border border-[var(--tint-purple-border)] bg-[var(--theme-bg-base)]">
          <div className={cn('flex items-center gap-2 border-b border-[var(--tint-purple-border)] px-3 py-1.5 text-[11px]', AI_TEXT)}>
            <SparkIcon size={11} /> Suggestion
            <button type="button" className="ml-auto text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]" aria-label="Dismiss suggestion" onClick={() => setResult(null)}>✕</button>
          </div>
          <pre className="whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--theme-text-primary)]">{result.command}</pre>
          {result.explanation && <p className="px-3 pb-2.5 text-xs text-[var(--theme-text-secondary)]">{result.explanation}</p>}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--tint-purple-border)] px-3 py-2">
            <span className={cn('inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium', RISK[result.risk].className)}>{RISK[result.risk].label}</span>
            {result.binaries.map((b) => (
              <Chip key={b.name} className={b.found ? undefined : tint('yellow')}>
                <span className="font-mono">{b.name}</span> {b.found ? '✓ found' : 'not found'}
              </Chip>
            ))}
            <span className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => void suggest(true)}>⟳ Another</Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onApply(result.command, intent.trim());
                setResult(null);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
