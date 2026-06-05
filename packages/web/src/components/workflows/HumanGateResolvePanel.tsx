import { useState } from 'react';
import { Button } from '../ui/Button';
import { useDraft } from '../../hooks/useDraft';

interface Props {
  runId: string;
  stepRunId: string;
  outcomes: string[];
  onResolve: (outcome: string, notes?: string) => Promise<void>;
}

export function HumanGateResolvePanel({ runId, stepRunId, outcomes, onResolve }: Props) {
  const { draft: notes, setDraft: setNotes, clearDraft } = useDraft(
    `human_gate_note_${runId}_${stepRunId}`,
  );
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const click = async (outcome: string) => {
    setBusy(true);
    setSubmitError(null);
    try {
      await onResolve(outcome, notes.trim() || undefined);
      // Only clear the in-progress note once the gate is successfully
      // resolved — on failure we keep it so the user doesn't lose their text.
      clearDraft();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
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
      {submitError && <div className="text-xs text-red-400">{submitError}</div>}
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
