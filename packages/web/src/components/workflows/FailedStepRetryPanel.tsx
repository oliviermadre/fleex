import { useState } from 'react';
import { Button } from '../ui/Button';

interface Props {
  // Error message stored in stepRun.output.schemaFields.error (or null when the
  // executor threw before producing structured output).
  error: string | null;
  onRetry: () => Promise<void>;
}

export function FailedStepRetryPanel({ error, onRetry }: Props) {
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const retry = async () => {
    setBusy(true);
    setSubmitError(null);
    try {
      await onRetry();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-red-500/40 bg-red-500/5 p-3">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-red-400">
          Step failed
        </div>
        {error && (
          <pre className="mt-2 whitespace-pre-wrap rounded bg-[var(--theme-bg-overlay)] p-2 text-[10px] text-[var(--theme-text-primary)]">
            {error}
          </pre>
        )}
      </div>
      {submitError && <div className="text-xs text-red-400">{submitError}</div>}
      <div className="flex justify-end">
        <Button variant="primary" size="sm" disabled={busy} onClick={retry}>
          {busy ? 'Retrying…' : 'Retry step'}
        </Button>
      </div>
    </div>
  );
}
