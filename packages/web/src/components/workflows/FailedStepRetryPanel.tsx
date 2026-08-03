import { useState } from 'react';
import { Button } from '../ui/Button';
import { tintClasses } from '../../lib/tints';

interface Props {
  // Error message stored in stepRun.output.schemaFields.error (or null when the
  // executor threw before producing structured output).
  error: string | null;
  onRetry: () => Promise<void>;
  // Abandons the step (→ `cancelled`), which is what makes this banner go away
  // for good. Reversible: a cancelled step can still be restarted.
  onDismiss: () => Promise<void>;
}

export function FailedStepRetryPanel({ error, onRetry, onDismiss }: Props) {
  const [busy, setBusy] = useState<'retry' | 'dismiss' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const run = (action: 'retry' | 'dismiss', fn: () => Promise<void>) => async () => {
    setBusy(action);
    setSubmitError(null);
    try {
      await fn();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const retry = run('retry', onRetry);
  const dismiss = run('dismiss', onDismiss);

  return (
    <div className={`space-y-3 rounded-md border ${tintClasses('red').borderColor} ${tintClasses('red').bg} p-3`}>
      <div>
        <div className={`text-xs font-medium uppercase tracking-wide ${tintClasses('red').text}`}>
          Step failed
        </div>
        {error && (
          <pre className="mt-2 whitespace-pre-wrap rounded bg-[var(--theme-bg-overlay)] p-2 text-[10px] text-[var(--theme-text-primary)]">
            {error}
          </pre>
        )}
      </div>
      {submitError && <div className={`text-xs ${tintClasses('red').text}`}>{submitError}</div>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={dismiss}>
          {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
        </Button>
        <Button variant="primary" size="sm" disabled={busy !== null} onClick={retry}>
          {busy === 'retry' ? 'Retrying…' : 'Retry step'}
        </Button>
      </div>
    </div>
  );
}
