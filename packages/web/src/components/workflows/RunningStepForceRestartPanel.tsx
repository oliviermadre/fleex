import { useState } from 'react';

import { tintClasses } from '../../lib/tints';
import { Button } from '../ui/Button';

interface Props {
  // ISO timestamp when this attempt started. Used to display how long the
  // step has been running — a useful signal when deciding whether to force
  // restart (a short-lived "running" likely IS running; an hour-old one is
  // probably orphaned).
  startedAt: string | null;
  onForceRestart: () => Promise<void>;
}

function formatDuration(startedAt: string | null): string {
  if (!startedAt) return '';
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function RunningStepForceRestartPanel({ startedAt, onForceRestart }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restart = async () => {
    setBusy(true);
    setError(null);
    try {
      await onForceRestart();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div
      className={`space-y-3 rounded-md border ${tintClasses('blue').borderColor} ${tintClasses('blue').bg} p-3`}
    >
      <div>
        <div className={`text-xs font-medium uppercase tracking-wide ${tintClasses('blue').text}`}>
          Step is running
        </div>
        <div className="mt-2 text-xs text-[var(--theme-text-secondary)]">
          Running for {formatDuration(startedAt)}. If the underlying process was killed (server
          hot-reload, crash, or the step is simply stuck), force restart to cancel this attempt and
          start a fresh one.
        </div>
      </div>
      {error && <div className="text-xs text-[var(--theme-danger)]">{error}</div>}
      <div className="flex justify-end gap-2">
        {confirming ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={restart}>
              {busy ? 'Restarting…' : 'Confirm force restart'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
            Force restart
          </Button>
        )}
      </div>
    </div>
  );
}
