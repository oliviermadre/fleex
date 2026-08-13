import { useCallback, useState } from 'react';
import { Button } from '../ui/Button';
import { useSettingsStore } from '../../stores/settingsStore';
import { applyPersonaCoachProposal, fetchPersonaCoachProposal, type PersonaCoachProposal } from '../../services/api';
import { tint } from '../../lib/tints';
import { cn } from '../../lib/cn';

const REASONS: Record<string, string> = {
  unavailable: 'Agent coaching is switched off in Settings › Memory.',
  not_found: 'This agent no longer exists.',
  no_evidence: 'No corrections or answered questions found for this agent yet. Coaching needs something to learn from.',
  nothing_to_learn: 'Nothing generalisable to add beyond what this agent already remembers.',
  synthesis_failed: 'Could not draft a proposal. Try again.',
};

/**
 * Proposes what an agent should have learned, next to the memory it would change.
 *
 * Sits under the editor rather than replacing it, and never writes on its own: the
 * memory document is prepended to every future run of this agent, so an
 * unreviewed rewrite could degrade it permanently — and invisibly, since nobody
 * re-reads a file they did not change. The proposal is shown in full, with the
 * corrections it drew on, and applying is a separate click.
 */
export function PersonaCoachPanel({
  personaId,
  onApplied,
}: {
  personaId: string;
  onApplied: (memoryMd: string) => void;
}) {
  const enabled = useSettingsStore((s) => s.settings.memoryEngine === 'semantic'
    && s.settings.memoryFeatures?.personaCoach !== false);

  const [proposal, setProposal] = useState<PersonaCoachProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [failed, setFailed] = useState(false);

  const handlePropose = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setProposal(await fetchPersonaCoachProposal(personaId));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  const handleApply = useCallback(async () => {
    if (!proposal?.proposedMemoryMd) return;
    setApplying(true);
    try {
      await applyPersonaCoachProposal(personaId, proposal.proposedMemoryMd);
      onApplied(proposal.proposedMemoryMd);
      setProposal(null);
    } finally {
      setApplying(false);
    }
  }, [proposal, personaId, onApplied]);

  if (!enabled) return null;

  return (
    <div className="mt-4 rounded border border-[var(--theme-border)] p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold text-[var(--theme-text-primary)]">
          Learn from your corrections
        </h4>
        <span className={cn('rounded px-1.5 py-0.5 text-[10px]', tint('orange'))}>
          one LLM call
        </span>
        <div className="flex-1" />
        <Button variant="secondary" disabled={loading} onClick={() => void handlePropose()}>
          {loading ? 'Reading…' : proposal ? 'Draft again' : 'Draft a proposal'}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-[var(--theme-text-muted)]">
        Drafts a replacement for this memory from the times you corrected this agent or answered
        its questions. Nothing is written until you accept it.
      </p>

      {failed && (
        <p className="mt-2 text-[11px] text-[var(--theme-danger)]">Could not reach the coach.</p>
      )}

      {proposal && !proposal.proposedMemoryMd && (
        <p className="mt-2 text-[11px] text-[var(--theme-text-muted)]">
          {REASONS[proposal.reason ?? ''] ?? 'No proposal.'}
        </p>
      )}

      {proposal?.proposedMemoryMd && (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--theme-text-muted)]">
              Proposed
            </span>
            <div className="flex-1" />
            <Button variant="secondary" onClick={() => setProposal(null)}>Discard</Button>
            <Button variant="primary" disabled={applying} onClick={() => void handleApply()}>
              {applying ? 'Applying…' : 'Accept'}
            </Button>
          </div>
          <pre className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] p-2.5 text-[11px] font-mono text-[var(--theme-text-secondary)]">
            {proposal.proposedMemoryMd}
          </pre>

          {proposal.evidence.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[10px] uppercase tracking-wider font-semibold text-[var(--theme-text-muted)]">
                Drawn from {proposal.evidence.length} exchange{proposal.evidence.length > 1 ? 's' : ''}
              </summary>
              <ul className="mt-1 space-y-0.5">
                {proposal.evidence.map((snippet) => (
                  <li key={`${snippet.sourceKind}:${snippet.sourceId}`} className="text-[11px] text-[var(--theme-text-muted)]">
                    {snippet.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
