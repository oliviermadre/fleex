import { useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, MarkerType, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkflowRun, StepRun, WorkflowStep } from '@fleex/shared';
import { StepRunNode, type StepRunNodeData } from './StepRunNode';
import { HumanGateResolvePanel } from './HumanGateResolvePanel';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';

const nodeTypes = { stepRun: StepRunNode };

interface Props {
  run: WorkflowRun;
  stepRuns: StepRun[];
}

export function WorkflowRunView({ run, stepRuns }: Props) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const cancel = useWorkflowRunStore((s) => s.cancel);
  const resolveGate = useWorkflowRunStore((s) => s.resolveGate);
  const retry = useWorkflowRunStore((s) => s.retry);

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
        const data: StepRunNodeData = {
          step,
          status: sr?.status ?? 'pending',
          summary: (sr?.output?.comment ?? undefined) as string | undefined,
          isCurrent: run.currentStepId === step.id,
          onSelect: setSelectedStepId,
        };
        return {
          id: step.id,
          type: 'stepRun',
          position: step.position,
          width: 180,
          height: 80,
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
        label:
          e.label ??
          (e.condition
            ? `${e.condition.field} ${e.condition.operator} ${String(e.condition.value)}`
            : ''),
        animated: latestPerStep.get(e.source)?.nextEdgeId === e.id,
        style: { strokeDasharray: e.isDefault ? undefined : '5,5' },
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    [run.templateSnapshot.edges, latestPerStep],
  );

  const selectedStep: WorkflowStep | undefined = selectedStepId
    ? stepIndex.get(selectedStepId)
    : undefined;
  const selectedStepRun = selectedStepId ? latestPerStep.get(selectedStepId) : undefined;

  const completed = stepRuns.filter((s) => s.status === 'completed').length;
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
            colorMode="dark"
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            minZoom={0.2}
            maxZoom={2}
            fitView
            fitViewOptions={{ padding: 0.4, minZoom: 0.5, maxZoom: 1.2 }}
          >
            <Background gap={16} size={1} color="rgba(255,255,255,0.08)" />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              maskColor="rgba(0,0,0,0.6)"
              style={{ background: 'var(--theme-bg-surface)', border: '1px solid var(--theme-border)' }}
              nodeColor="rgba(168,85,247,0.4)"
              nodeStrokeColor="rgba(168,85,247,0.8)"
            />
          </ReactFlow>
        </div>

        {/* Step detail sidebar */}
        {selectedStep && (
          <div
            className="w-[320px] p-4 overflow-y-auto space-y-3"
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
                  outcomes={
                    (selectedStepRun.output?.schemaFields?.outcomes as string[]) ??
                    selectedStep.humanGateOutcomes ??
                    []
                  }
                  onResolve={(outcome, notes) =>
                    resolveGate(run.id, selectedStepRun.id, outcome, notes)
                  }
                  onRetry={() => retry(run.id, selectedStepRun.id)}
                />
              )}
          </div>
        )}
      </div>
    </div>
  );
}
