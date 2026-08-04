import { useState } from 'react';
import { Button } from '../ui/Button';
import { useDraft } from '../../hooks/useDraft';
import { MarkdownEditor } from '../markdown/MarkdownEditor';

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
      <MarkdownEditor
        variant="composer"
        surfaceKind="workflow_gate_notes"
        value={notes}
        onChange={setNotes}
        minRows={3}
        placeholder="Notes (optional, injected as context for the next step)"
      />
      {submitError && <div className="text-xs text-[var(--theme-danger)]">{submitError}</div>}
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
