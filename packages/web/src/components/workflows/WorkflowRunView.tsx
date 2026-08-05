import { useCallback, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, MarkerType, Position, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { formatEdgeCondition, normalizeEdgeCondition } from '@fleex/shared';
import type { WorkflowRun, StepRun, WorkflowStep, TicketDeliverable } from '@fleex/shared';
import { StepRunNode, type StepRunNodeData } from './StepRunNode';
import { WorkflowDagEdge } from './WorkflowDagEdge';
import { HumanGateResolvePanel } from './HumanGateResolvePanel';
import { AmbiguousRouteResolvePanel } from './AmbiguousRouteResolvePanel';
import { NeedsReviewRespondPanel } from './NeedsReviewRespondPanel';
import { FailedStepRetryPanel } from './FailedStepRetryPanel';
import { RunningStepForceRestartPanel } from './RunningStepForceRestartPanel';
import { CancelledStepRestartPanel } from './CancelledStepRestartPanel';
import { StepSessionOverlay } from './StepSessionOverlay';
import { StepOutputView } from './StepOutputView';
import { splitStepDeliverables } from './stepDeliverableSplit';
import { stepSessionState } from './stepSession';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { useUIStore } from '../../stores/uiStore';
import { useDeliverableTypesStore } from '../../stores/deliverableTypesStore';
import { tint } from '../../lib/tints';
import { countCompletedSteps } from './workflowProgress';
import { postTicketComment } from '../../services/api';
import { useActiveTheme, useColorMode } from '../../hooks/useActiveTheme';

const nodeTypes = { stepRun: StepRunNode };
const edgeTypes = { workflow: WorkflowDagEdge };

interface Props {
  run: WorkflowRun;
  stepRuns: StepRun[];
  /**
   * The deliverables this run produced, attributed back to their producing
   * step (icon on the node + list in the step sidebar). Optional: surfaces
   * that don't have them at hand (e.g. the ticket workflow tab) just get no
   * markers.
   */
  deliverables?: TicketDeliverable[];
}

/** Sidebar width bounds. Below 320px the output columns collapse; above 80% of
 *  the view the DAG is no longer usable. */
const SIDEBAR_MIN_WIDTH = 320;
const DEFAULT_SIDEBAR_WIDTH = 420;

export function WorkflowRunView({ run, stepRuns, deliverables = [] }: Props) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const bodyRef = useRef<HTMLDivElement>(null);
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

  // Deliverable → producing step. The only linkage is the `agentName` contract
  // written by persistStepArtifacts — `workflow:{name} → {step name}` — which
  // is already what the ticket Deliverables tab renders verbatim. Parsed here
  // rather than persisted as a FK: the string IS the contract.
  const deliverablesByStepId = useMemo(() => {
    const idByName = new Map<string, string>();
    for (const s of run.templateSnapshot.steps) {
      if (!idByName.has(s.name)) idByName.set(s.name, s.id);
    }
    const m = new Map<string, TicketDeliverable[]>();
    for (const d of deliverables) {
      const sep = d.agentName.lastIndexOf(' → ');
      if (sep < 0) continue;
      const stepId = idByName.get(d.agentName.slice(sep + 3));
      if (!stepId) continue;
      m.set(stepId, [...(m.get(stepId) ?? []), d]);
    }
    return m;
  }, [run.templateSnapshot.steps, deliverables]);

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
          deliverableCount: deliverablesByStepId.get(step.id)?.length ?? 0,
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
    [run.templateSnapshot.steps, latestPerStep, run.currentStepId, deliverablesByStepId],
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

  // The latest attempt's deliverable is shown inside its output; the earlier
  // attempts' stay in the box above. See stepDeliverableSplit.
  const { latestDeliverable, previousDeliverables } = useMemo(
    () =>
      splitStepDeliverables(
        (selectedStep ? deliverablesByStepId.get(selectedStep.id) : undefined) ?? [],
        selectedStepRun?.output?.deliverable?.title,
      ),
    [selectedStep, selectedStepRun, deliverablesByStepId],
  );

  const completed = countCompletedSteps(stepRuns);
  const total = run.templateSnapshot.steps.length;

  // Drag from the sidebar's left edge. Width is measured against the body
  // container, not the viewport, so it behaves the same in the full-page run
  // view and in the (narrower) ticket workflow tab.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const body = bodyRef.current;
    if (!body) return;

    const onMove = (ev: MouseEvent) => {
      const rect = body.getBoundingClientRect();
      const raw = rect.right - ev.clientX;
      setSidebarWidth(Math.max(SIDEBAR_MIN_WIDTH, Math.min(raw, rect.width * 0.8)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

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
      <div ref={bodyRef} className="flex flex-1 overflow-hidden">
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
          <>
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={startResize}
            className="group/h relative w-[3px] flex-shrink-0 cursor-col-resize bg-[var(--theme-border)] transition-colors hover:bg-[var(--theme-accent)] active:bg-[var(--theme-accent)]"
          >
            {/* Wider invisible hit-area for easier grabbing */}
            <span className="absolute inset-y-0 -left-1 -right-1" />
          </div>
          <div
            className="flex-shrink-0 p-4 overflow-y-auto space-y-3"
            style={{ width: sidebarWidth }}
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
            {previousDeliverables.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
                  {latestDeliverable ? 'Previous deliverables' : 'Deliverables'}
                </div>
                {previousDeliverables.map((d) => (
                  <StepDeliverableRow key={d.id} deliverable={d} />
                ))}
              </div>
            )}
            {selectedStepRun?.output && (
              <StepOutputView output={selectedStepRun.output} latestDeliverable={latestDeliverable} />
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
          </>
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

function stepDeliverableAge(dateStr: string): string {
  const minutes = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * One deliverable produced by the selected step — the same main info as the
 * ticket Deliverables tab (configured type badge, title, draft state, age),
 * opening in the shared reading overlay.
 */
function StepDeliverableRow({ deliverable: d }: { deliverable: TicketDeliverable }) {
  const openDeliverableOverlay = useUIStore((s) => s.openDeliverableOverlay);
  const labelForType = useDeliverableTypesStore((s) => s.labelFor);
  const colorForType = useDeliverableTypesStore((s) => s.colorFor);
  const c = colorForType(d.type);
  const contentIsUrl = /^https?:\/\/\S+$/.test(d.content.trim());
  return (
    <button
      type="button"
      onClick={() =>
        contentIsUrl ? window.open(d.content.trim(), '_blank', 'noopener') : openDeliverableOverlay(d)
      }
      title={d.title}
      className="flex w-full items-center gap-2 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--theme-bg-hover)]"
    >
      <span
        className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${c ? '' : 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)]'}`}
        style={c ? { backgroundColor: c.bg, color: c.text } : undefined}
      >
        {labelForType(d.type)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--theme-text-primary)]">
        {d.title}
      </span>
      {d.status === 'draft' && (
        <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${tint('yellow')}`}>
          draft
        </span>
      )}
      <span className="shrink-0 text-[10px] text-[var(--theme-text-faint)]">
        {stepDeliverableAge(d.createdAt)}
      </span>
    </button>
  );
}
