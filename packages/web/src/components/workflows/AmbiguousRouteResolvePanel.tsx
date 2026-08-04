import { useState } from 'react';
import type { WorkflowEdge, WorkflowStep } from '@fleex/shared';
import { describeEdge } from '@fleex/shared';
import { Button } from '../ui/Button';
import { useDraft } from '../../hooks/useDraft';

interface Props {
  runId: string;
  stepRunId: string;
  candidates: WorkflowEdge[];
  steps: WorkflowStep[];
  onResolve: (edgeId: string, notes?: string) => Promise<void>;
}

/**
 * Arbitrating an ambiguous route. Mirrors the human gate panel — same draft
 * persistence, same "keep the note on failure" rule — because to the reviewer
 * this is the same act: read the situation, leave a reason, pick a branch.
 */
export function AmbiguousRouteResolvePanel({
  runId, stepRunId, candidates, steps, onResolve,
}: Props) {
  const { draft: notes, setDraft: setNotes, clearDraft } = useDraft(
    `ambiguous_route_note_${runId}_${stepRunId}`,
  );
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const click = async (edgeId: string) => {
    setBusy(true);
    setSubmitError(null);
    try {
      await onResolve(edgeId, notes.trim() || undefined);
      // Only clear the note once the route is actually taken — on failure the
      // reviewer keeps their reasoning and can retry.
      clearDraft();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-[var(--theme-text-primary)]">Choose the branch</h3>
      <p className="text-xs text-[var(--theme-text-secondary)]">
        Several outgoing edges matched at once, so the run is paused. Pick the one to follow.
      </p>
      <textarea
        placeholder="Why this branch? (optional, posted in the thread)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        className="w-full resize-y rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] outline-none focus:border-[var(--theme-accent)] focus:ring-1 focus:ring-[var(--theme-accent)]"
      />
      {submitError && <div className="text-xs text-[var(--theme-danger)]">{submitError}</div>}
      <div className="flex flex-col gap-2">
        {candidates.map((edge) => (
          <Button
            key={edge.id}
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => click(edge.id)}
          >
            {describeEdge(edge, steps)}
          </Button>
        ))}
      </div>
    </div>
  );
}
