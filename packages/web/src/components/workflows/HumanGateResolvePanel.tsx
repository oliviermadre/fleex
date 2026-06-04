import { useState } from 'react';
import { Button } from '../ui/Button';

interface Props {
  outcomes: string[];
  onResolve: (outcome: string, notes?: string) => Promise<void>;
}

export function HumanGateResolvePanel({ outcomes, onResolve }: Props) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const click = async (outcome: string) => {
    setBusy(true);
    try {
      await onResolve(outcome, notes.trim() || undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-[var(--theme-text-primary)]">Resolve gate</h3>
      <textarea
        placeholder="Notes (optional, injected as context for the next step)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        className="w-full resize-y rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] outline-none focus:border-[var(--theme-accent)] focus:ring-1 focus:ring-[var(--theme-accent)]"
      />
      <div className="flex flex-wrap gap-2">
        {outcomes.map((o) => (
          <Button key={o} variant="primary" size="sm" disabled={busy} onClick={() => click(o)}>
            {o}
          </Button>
        ))}
      </div>
    </div>
  );
}
