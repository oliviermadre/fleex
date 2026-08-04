import { useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, MarkerType, Position, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { formatEdgeCondition, normalizeEdgeCondition } from '@fleex/shared';
import type { WorkflowRun, StepRun, WorkflowStep } from '@fleex/shared';
import { StepRunNode, type StepRunNodeData } from './StepRunNode';
import { WorkflowDagEdge } from './WorkflowDagEdge';
import { HumanGateResolvePanel } from './HumanGateResolvePanel';
import { AmbiguousRouteResolvePanel } from './AmbiguousRouteResolvePanel';
import { NeedsReviewRespondPanel } from './NeedsReviewRespondPanel';
import { FailedStepRetryPanel } from './FailedStepRetryPanel';
import { RunningStepForceRestartPanel } from './RunningStepForceRestartPanel';
import { CancelledStepRestartPanel } from './CancelledStepRestartPanel';
import { StepSessionOverlay } from './StepSessionOverlay';
import { stepSessionState } from './stepSession';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { countCompletedSteps } from './workflowProgress';
import { postTicketComment } from '../../services/api';
import { useActiveTheme, useColorMode } from '../../hooks/useActiveTheme';

const nodeTypes = { stepRun: StepRunNode };
const edgeTypes = { workflow: WorkflowDagEdge };

interface Props {
  run: WorkflowRun;
  stepRuns: StepRun[];
}

export function WorkflowRunView({ run, stepRuns }: Props) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  // The SDK session currently opened in the floating popup, if any.
  const [openSession, setOpenSession] = useState<
    { executionId: string; stepName: string } | null
  >(null);
  const colorMode = useColorMode();
  const themeColors = useActiveTheme().colors;
  const cancel = useWorkflowRunStore((s) => s.cancel);
  const resolveGate = useWorkflowRunStore((s) => s.resolveGate);
  const retry = useWorkflowRunStore((s) => s.retry);
  const resolveRoute = useWorkflowRunStore((s) => s.resolveRoute);

  const stepIndex = useMemo(
    () => new Map(run.templateSnapshot.steps.map((s) => [s.id, s])),
    [run.templateSnapshot.steps],
  );

  const latestPerStep = useMemo(() => {
    const m = new Map<string, StepRun>();
    for (const sr of stepRuns) {
      const cur = m.get(sr.stepId);
      if (!cur || sr.attempt > cur.attempt) m.set(sr.stepId, sr);
    }
    return m;
  }, [stepRuns]);

  const nodes = useMemo(
    () =>
      run.templateSnapshot.steps.map((step) => {
        const sr = latestPerStep.get(step.id);
        const session = stepSessionState(step, sr);
        const data: StepRunNodeData = {
          step,
          status: sr?.status ?? 'pending',
          summary: (sr?.output?.comment ?? undefined) as string | undefined,
          isCurrent: run.currentStepId === step.id,
          onSelect: setSelectedStepId,
          onOpenSession:
            session.kind === 'available'
              ? () =>
                  setOpenSession({ executionId: session.executionId, stepName: step.name })
              : undefined,
        };
        return {
          id: step.id,
          type: 'stepRun',
          position: step.position,
          width: 180,
          height: 80,
          handles: [
            { id: null, type: 'target' as const, position: Position.Left, x: 0, y: 40, width: 1, height: 1 },
            { id: null, type: 'source' as const, position: Position.Right, x: 180, y: 40, width: 1, height: 1 },
          ],
          data: data as unknown as Record<string, unknown>,
        };
      }),
    [run.templateSnapshot.steps, latestPerStep, run.currentStepId],
  );

  const edges: Edge[] = useMemo(
    () =>
      run.templateSnapshot.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'workflow',
        // Same renderer as the editor: the hand-rolled fallback this replaces
        // only understood the legacy single `condition`, so every edge built
        // with a condition *group* (the norm since assisted authoring) rendered
        // with no label at all.
        label: e.label ?? formatEdgeCondition(normalizeEdgeCondition(e), run.templateSnapshot.steps),
        animated: latestPerStep.get(e.source)?.nextEdgeId === e.id,
        style: { strokeDasharray: e.isDefault ? undefined : '5,5' },
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    [run.templateSnapshot.edges, run.templateSnapshot.steps, latestPerStep],
  );

  const selectedStep: WorkflowStep | undefined = selectedStepId
    ? stepIndex.get(selectedStepId)
    : undefined;
  const selectedStepRun = selectedStepId ? latestPerStep.get(selectedStepId) : undefined;
  const selectedSession = selectedStep
    ? stepSessionState(selectedStep, selectedStepRun)
    : ({ kind: 'none' } as const);

  const completed = countCompletedSteps(stepRuns);
  const total = run.templateSnapshot.steps.length;

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--theme-border)' }}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{run.templateSnapshot.emoji}</span>
          <div>
            <div className="text-sm font-medium text-[var(--theme-text-primary)]">
              {run.templateSnapshot.name}
            </div>
            <div className="text-xs text-[var(--theme-text-muted)]">
              {completed}/{total} steps completed
            </div>
          </div>
          <span
            className="text-[10px] px-2 py-0.5 rounded border border-[var(--theme-border-input)] text-[var(--theme-text-secondary)]"
          >
            {run.status}
          </span>
        </div>
        {['running', 'blocked', 'needs_review'].includes(run.status) && (
          <button
            onClick={() => cancel(run.id)}
            className="text-xs px-3 py-1 rounded border border-[var(--theme-border-input)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-overlay)] transition-colors"
          >
            Cancel run
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* DAG canvas */}
        <div className="flex-1">
          <ReactFlow
            colorMode={colorMode}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            minZoom={0.2}
            maxZoom={2}
            fitView
            fitViewOptions={{ padding: 0.4, minZoom: 0.5, maxZoom: 1.2 }}
            defaultMarkerColor={themeColors.textMuted}
          >
            <Background gap={16} size={1} color={themeColors.borderSubtle} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              maskColor={themeColors.bgHover}
              style={{ background: 'var(--theme-bg-surface)', border: '1px solid var(--theme-border)' }}
              nodeColor={themeColors.accentMuted}
              nodeStrokeColor={themeColors.accent}
            />
          </ReactFlow>
        </div>

        {/* Step detail sidebar */}
        {selectedStep && (
          <div
            className="w-[420px] p-4 overflow-y-auto space-y-3"
            style={{ borderLeft: '1px solid var(--theme-border)' }}
          >
            <h3 className="text-sm font-medium text-[var(--theme-text-primary)]">
              {selectedStep.name}
            </h3>
            <div className="text-xs text-[var(--theme-text-muted)] space-y-1">
              <div>
                Type: <code>{selectedStep.executorType}</code>
              </div>
              <div>
                Ref: <code>{selectedStep.executorRef || '—'}</code>
              </div>
              {selectedStepRun && (
                <div>
                  Status: <code>{selectedStepRun.status}</code> (attempt {selectedStepRun.attempt})
                </div>
              )}
            </div>
            {/* The step's Claude SDK session. Available as soon as the agent
                starts, so a step still running opens on a live stream. */}
            {selectedSession.kind === 'available' && (
              <button
                onClick={() =>
                  setOpenSession({
                    executionId: selectedSession.executionId,
                    stepName: selectedStep.name,
                  })
                }
                className="w-full text-xs px-3 py-1.5 rounded border border-[var(--theme-border-input)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-overlay)] transition-colors"
              >
                {selectedSession.live ? 'Watch SDK session (live)' : 'View SDK session'}
              </button>
            )}
            {selectedStepRun?.output && (
              <details className="text-xs">
                <summary className="cursor-pointer text-[var(--theme-text-secondary)]">
                  Output
                </summary>
                <pre className="mt-2 p-2 rounded bg-[var(--theme-bg-overlay)] overflow-x-auto text-[10px] text-[var(--theme-text-primary)]">
                  {JSON.stringify(selectedStepRun.output, null, 2)}
                </pre>
              </details>
            )}
            {selectedStepRun?.status === 'needs_review' &&
              selectedStep.executorType === 'human_gate' && (
                <HumanGateResolvePanel
                  runId={run.id}
                  stepRunId={selectedStepRun.id}
                  outcomes={
                    (selectedStepRun.output?.schemaFields?.outcomes as string[]) ??
                    selectedStep.humanGateOutcomes ??
                    []
                  }
                  onResolve={(outcome, notes) =>
                    resolveGate(run.id, selectedStepRun.id, outcome, notes)
                  }
                />
              )}
            {selectedStepRun?.status === 'needs_review' &&
              selectedStep.executorType !== 'human_gate' && (
                <NeedsReviewRespondPanel
                  runId={run.id}
                  stepRunId={selectedStepRun.id}
                  question={selectedStepRun.output?.comment}
                  onSubmit={async (response) => {
                    // The response travels with the retry: the server records it
                    // on the paused attempt and the new attempt reads it back
                    // from the run history. This is the ONLY channel on a routine
                    // run — it has no ticket timeline. On a ticket run we also
                    // post it as a comment so it stays visible in the thread.
                    if (run.ticketId) await postTicketComment(run.ticketId, response);
                    await retry(run.id, selectedStepRun.id, response);
                  }}
                />
              )}
            {selectedStepRun?.status === 'awaiting_routing' && (
              // Candidates come from what was persisted when the run paused, not
              // from the template — the same set the engine actually saw.
              <AmbiguousRouteResolvePanel
                runId={run.id}
                stepRunId={selectedStepRun.id}
                candidates={run.templateSnapshot.edges.filter((e) =>
                  (selectedStepRun.output?.routing?.candidateEdgeIds ?? []).includes(e.id),
                )}
                steps={run.templateSnapshot.steps}
                onResolve={(edgeId, notes) =>
                  resolveRoute(run.id, selectedStepRun.id, edgeId, notes)
                }
              />
            )}
            {selectedStepRun?.status === 'failed' && (
              <FailedStepRetryPanel
                error={
                  (selectedStepRun.output?.schemaFields?.error as string | undefined) ??
                  null
                }
                onRetry={() => retry(run.id, selectedStepRun.id)}
              />
            )}
            {selectedStepRun?.status === 'running' && (
              <RunningStepForceRestartPanel
                startedAt={selectedStepRun.startedAt}
                onForceRestart={() => retry(run.id, selectedStepRun.id)}
              />
            )}
            {selectedStepRun?.status === 'cancelled' && (
              <CancelledStepRestartPanel
                onRestart={() => retry(run.id, selectedStepRun.id)}
              />
            )}
          </div>
        )}
      </div>

      {openSession && (
        <StepSessionOverlay
          executionId={openSession.executionId}
          stepName={openSession.stepName}
          // Derived from the live step-runs rather than captured at open time,
          // so the "live" badge clears on its own when the step finishes while
          // the popup is still open.
          live={stepRuns.some(
            (sr) => sr.executionId === openSession.executionId && sr.status === 'running',
          )}
          onClose={() => setOpenSession(null)}
        />
      )}
    </div>
  );
}
