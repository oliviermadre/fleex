import { useState } from 'react';

import { tintClasses } from '../../lib/tints';
import { Button } from '../ui/Button';

interface Props {
  // Error message stored in stepRun.output.schemaFields.error (or null when the
  // executor threw before producing structured output).
  error: string | null;
  onRetry: () => Promise<void>;
  // The three props below are OPTIONAL so the Workflow tab renders exactly as
  // before; they exist for the Comments thread, which shows this panel out of
  // context and so needs to say WHICH step of WHICH workflow failed, plus a way
  // to reach the logs without switching tabs. Keep them optional.
  title?: string;
  attempt?: number;
  onViewLogs?: () => void;
}

export function FailedStepRetryPanel({ error, onRetry, title, attempt, onViewLogs }: Props) {
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
    <div
      className={`space-y-3 rounded-md border ${tintClasses('red').borderColor} ${tintClasses('red').bg} p-3`}
    >
      <div>
        <div className={`text-xs font-medium uppercase tracking-wide ${tintClasses('red').text}`}>
          {title ?? 'Step failed'}
          {attempt != null && ` · attempt ${attempt}`}
        </div>
        {error ? (
          // Scrollable: a stack trace must not blow up the height of the thread.
          <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-[var(--theme-bg-overlay)] p-2 text-[10px] text-[var(--theme-text-primary)]">
            {error}
          </pre>
        ) : (
          <p className="mt-2 text-[10px] text-[var(--theme-text-muted)]">
            No error message was recorded.
          </p>
        )}
      </div>
      {submitError && <div className={`text-xs ${tintClasses('red').text}`}>{submitError}</div>}
      <div className="flex items-center justify-end gap-3">
        {onViewLogs && (
          <button
            type="button"
            className="text-xs font-medium text-[var(--theme-text-muted)] underline-offset-2 hover:text-[var(--theme-accent)] hover:underline"
            onClick={onViewLogs}
          >
            View logs
          </button>
        )}
        <Button variant="primary" size="sm" disabled={busy} onClick={retry}>
          {busy ? 'Retrying…' : 'Retry step'}
        </Button>
      </div>
    </div>
  );
}
