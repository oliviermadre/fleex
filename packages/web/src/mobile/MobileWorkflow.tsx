import { useEffect, useMemo, useState } from 'react';
import type { StepRun, StepRunStatus, WorkflowRun, WorkflowStep } from '@fleex/shared';
import { useWorkflowRunStore, ACTIVE_STATUSES } from '../stores/workflowRunStore';
import { postTicketComment } from '../services/api';
import { countCompletedSteps } from '../components/workflows/workflowProgress';
import { tint, tintText } from '../lib/tints';

/**
 * Mobile workflow run view: the desktop DAG (xyflow) doesn't fit a phone, so
 * the run is rendered as an ordered step list. Human interactions are the
 * whole point here — resolving human gates, answering needs_review questions
 * and retrying failed steps must work from the phone.
 */

const STEP_STATUS_ICON: Record<StepRunStatus | 'pending', { icon: string; className: string }> = {
  pending: { icon: '○', className: 'text-[var(--theme-text-faint)]' },
  queued: { icon: '◔', className: 'text-[var(--theme-text-muted)]' },
  running: { icon: '●', className: `animate-pulse ${tintText('yellow')}` },
  completed: { icon: '✓', className: tintText('green') },
  failed: { icon: '✗', className: tintText('red') },
  needs_review: { icon: '✋', className: tintText('purple') },
  cancelled: { icon: '⊘', className: tintText('gray') },
  skipped: { icon: '↷', className: 'text-[var(--theme-text-faint)]' },
};

const RUN_STATUS_BADGE: Record<WorkflowRun['status'], string> = {
  running: tint('yellow'),
  blocked: tint('purple'),
  needs_review: tint('purple'),
  completed: tint('green'),
  failed: tint('red'),
  cancelled: tint('gray'),
};

export function MobileWorkflow({ ticketId }: { ticketId: string }) {
  const loadForTicket = useWorkflowRunStore((s) => s.loadForTicket);
  const loadDetail = useWorkflowRunStore((s) => s.loadDetail);
  const cancel = useWorkflowRunStore((s) => s.cancel);
  const resolveGate = useWorkflowRunStore((s) => s.resolveGate);
  const retry = useWorkflowRunStore((s) => s.retry);
  const runs = useWorkflowRunStore((s) => s.runsByTicket[ticketId]);
  const detail = useWorkflowRunStore((s) => s.detail);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { active, history } = useMemo(() => {
    const list = runs ?? [];
    return {
      active: list.find((r) => ACTIVE_STATUSES.has(r.status)),
      history: list.filter((r) => !ACTIVE_STATUSES.has(r.status)),
    };
  }, [runs]);

  useEffect(() => {
    void loadForTicket(ticketId);
  }, [ticketId, loadForTicket]);

  const currentRunId = active?.id ?? selectedRunId ?? history[0]?.id;

  // Same rationale as the desktop TicketWorkflowTab: always refetch on mount /
  // run change; the store's seq guard discards stale in-flight responses.
  useEffect(() => {
    if (currentRunId) void loadDetail(currentRunId);
  }, [currentRunId, loadDetail]);

  const d = currentRunId ? detail[currentRunId] : undefined;

  if (!runs || runs.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--theme-text-faint)]">
        Aucun run de workflow sur ce ticket.
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {!active && history.length > 1 && (
        <select
          value={currentRunId ?? ''}
          onChange={(e) => setSelectedRunId(e.target.value)}
          className="mb-3 w-full appearance-none rounded-md bg-[var(--theme-bg-secondary)] px-3 py-2 text-xs text-[var(--theme-text-primary)]"
        >
          {history.map((r) => (
            <option key={r.id} value={r.id}>
              {r.templateSnapshot.emoji} {r.templateSnapshot.name} — {new Date(r.startedAt).toLocaleString('fr-FR')}
            </option>
          ))}
        </select>
      )}
      {d ? (
        <MobileRunView
          run={d.run}
          stepRuns={d.stepRuns}
          onCancel={() => cancel(d.run.id)}
          onResolveGate={(stepRunId, outcome, notes) => resolveGate(d.run.id, stepRunId, outcome, notes)}
          onRespondReview={async (response, stepRunId) => {
            // Same flow as desktop: the response becomes a ticket comment the
            // agent reads on the next run, then the step is retried.
            await postTicketComment(d.run.ticketId, response);
            await retry(d.run.id, stepRunId);
          }}
          onRetry={(stepRunId) => retry(d.run.id, stepRunId)}
        />
      ) : (
        <p className="py-8 text-center text-sm text-[var(--theme-text-faint)]">Chargement…</p>
      )}
    </div>
  );
}

function MobileRunView({
  run,
  stepRuns,
  onCancel,
  onResolveGate,
  onRespondReview,
  onRetry,
}: {
  run: WorkflowRun;
  stepRuns: StepRun[];
  onCancel: () => void;
  onResolveGate: (stepRunId: string, outcome: string, notes?: string) => Promise<void>;
  onRespondReview: (response: string, stepRunId: string) => Promise<void>;
  onRetry: (stepRunId: string) => Promise<void>;
}) {
  const latestPerStep = useMemo(() => {
    const m = new Map<string, StepRun>();
    for (const sr of stepRuns) {
      const cur = m.get(sr.stepId);
      if (!cur || sr.attempt > cur.attempt) m.set(sr.stepId, sr);
    }
    return m;
  }, [stepRuns]);

  // Auto-expand the step waiting on a human, else the current step.
  const actionStepId = useMemo(() => {
    const needsHuman = run.templateSnapshot.steps.find((s) => {
      const st = latestPerStep.get(s.id)?.status;
      return st === 'needs_review' || st === 'failed';
    });
    return needsHuman?.id ?? run.currentStepId ?? null;
  }, [run.templateSnapshot.steps, run.currentStepId, latestPerStep]);

  // null = follow actionStepId; 'none' = user explicitly collapsed everything
  const [expandedId, setExpandedId] = useState<string | 'none' | null>(null);
  const openId = expandedId === null ? actionStepId : expandedId === 'none' ? null : expandedId;

  const completed = countCompletedSteps(stepRuns);
  const total = run.templateSnapshot.steps.length;
  const isActive = ACTIVE_STATUSES.has(run.status);

  return (
    <div>
      {/* Run header */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xl">{run.templateSnapshot.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">
            {run.templateSnapshot.name}
          </p>
          <p className="text-[11px] text-[var(--theme-text-faint)]">{completed}/{total} étapes</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${RUN_STATUS_BADGE[run.status]}`}>
          {run.status}
        </span>
        {isActive && (
          <button
            onClick={onCancel}
            className="shrink-0 rounded-md border border-[var(--theme-border)] px-2 py-1 text-[11px] text-[var(--theme-text-muted)]"
          >
            Annuler
          </button>
        )}
      </div>

      {/* Step list */}
      <div className="flex flex-col gap-1.5">
        {run.templateSnapshot.steps.map((step) => {
          const sr = latestPerStep.get(step.id);
          const status = sr?.status ?? 'pending';
          const badge = STEP_STATUS_ICON[status];
          const isCurrent = run.currentStepId === step.id;
          const isOpen = openId === step.id;
          return (
            <div
              key={step.id}
              className={`rounded-xl border ${
                isCurrent ? 'border-[var(--theme-accent)]' : 'border-[var(--theme-border)]'
              } bg-[var(--theme-bg-secondary)]`}
            >
              <button
                onClick={() => setExpandedId(isOpen ? 'none' : step.id)}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
              >
                <span className={`w-5 shrink-0 text-center text-sm ${badge.className}`}>{badge.icon}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--theme-text-primary)]">
                  {step.name}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--theme-text-faint)]">
                  {step.executorType === 'human_gate' ? '✋ gate' : step.executorType}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-[var(--theme-border)] px-3 py-2.5">
                  <MobileStepDetail
                    step={step}
                    stepRun={sr}
                    onResolveGate={onResolveGate}
                    onRespondReview={onRespondReview}
                    onRetry={onRetry}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MobileStepDetail({
  step,
  stepRun,
  onResolveGate,
  onRespondReview,
  onRetry,
}: {
  step: WorkflowStep;
  stepRun: StepRun | undefined;
  onResolveGate: (stepRunId: string, outcome: string, notes?: string) => Promise<void>;
  onRespondReview: (response: string, stepRunId: string) => Promise<void>;
  onRetry: (stepRunId: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNotes('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const comment = stepRun?.output?.comment;
  const isGate = step.executorType === 'human_gate';
  const gateOutcomes =
    ((stepRun?.output?.schemaFields?.['outcomes'] as string[] | undefined) ??
      step.humanGateOutcomes ??
      []) as string[];

  return (
    <div className="space-y-2.5">
      {stepRun && (
        <p className="text-[11px] text-[var(--theme-text-faint)]">
          {stepRun.status} · tentative {stepRun.attempt}
          {stepRun.executionId ? ` · exec ${stepRun.executionId.slice(0, 8)}` : ''}
        </p>
      )}
      {comment && (
        <p className="whitespace-pre-wrap rounded-lg bg-[var(--theme-bg-hover)] p-2.5 text-xs text-[var(--theme-text-secondary)]">
          {comment}
        </p>
      )}

      {/* Human gate: pick an outcome, optional notes for the next step */}
      {stepRun?.status === 'needs_review' && isGate && (
        <div className="space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optionnel, injecté dans l'étape suivante)"
            rows={2}
            className="w-full resize-none rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-2.5 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
          />
          <div className="flex flex-wrap gap-2">
            {gateOutcomes.map((o) => (
              <button
                key={o}
                disabled={busy}
                onClick={() => act(() => onResolveGate(stepRun.id, o, notes.trim() || undefined))}
                className="rounded-lg bg-[var(--theme-accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Agent step waiting for info: answer → comment + retry */}
      {stepRun?.status === 'needs_review' && !isGate && (
        <div className="space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ta réponse (postée en commentaire, puis l'étape est relancée)"
            rows={3}
            className="w-full resize-none rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-2.5 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
          />
          <button
            disabled={busy || !notes.trim()}
            onClick={() => act(() => onRespondReview(notes.trim(), stepRun.id))}
            className="rounded-lg bg-[var(--theme-accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Répondre et relancer
          </button>
        </div>
      )}

      {/* Failed / cancelled: retry */}
      {(stepRun?.status === 'failed' || stepRun?.status === 'cancelled') && (
        <div className="space-y-2">
          {stepRun.status === 'failed' && (
            <p className={`rounded-lg border p-2 text-xs ${tint('red')}`}>
              {(stepRun.output?.schemaFields?.['error'] as string | undefined) ?? 'Étape échouée'}
            </p>
          )}
          <button
            disabled={busy}
            onClick={() => act(() => onRetry(stepRun.id))}
            className="rounded-lg bg-[var(--theme-accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {stepRun.status === 'failed' ? 'Réessayer' : 'Relancer'}
          </button>
        </div>
      )}

      {error && <p className={`text-xs ${tintText('red')}`}>{error}</p>}
    </div>
  );
}
