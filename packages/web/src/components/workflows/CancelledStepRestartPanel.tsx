import { useState } from 'react';

import { Button } from '../ui/Button';

interface Props {
  onRestart: () => Promise<void>;
}

/**
 * A step settles to `cancelled` when its agent execution was deliberately
 * terminated (the Terminate button on the execution stream). That's a user
 * action, not a failure — but the run is then stuck with no way forward. This
 * panel surfaces the restart path: it spawns a fresh attempt (attempt+1) and
 * re-arms the run to `running`, exactly like retrying a failed step.
 */
export function CancelledStepRestartPanel({ onRestart }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restart = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRestart();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] p-3">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-[var(--theme-text-secondary)]">
          Step cancelled
        </div>
        <div className="mt-2 text-xs text-[var(--theme-text-secondary)]">
          This step was terminated. Restart it to spawn a fresh attempt and resume the workflow from
          here.
        </div>
      </div>
      {error && <div className="text-xs text-[var(--theme-danger)]">{error}</div>}
      <div className="flex justify-end">
        <Button variant="primary" size="sm" disabled={busy} onClick={restart}>
          {busy ? 'Restarting…' : 'Restart step'}
        </Button>
      </div>
    </div>
  );
}
