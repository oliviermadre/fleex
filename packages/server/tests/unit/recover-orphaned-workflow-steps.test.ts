import { describe, it, expect, vi } from 'vitest';
import { RecoverOrphanedWorkflowStepsUseCase } from '../../src/application/use-cases/recover-orphaned-workflow-steps.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';

const makeRun = () => WorkflowRunEntity.create({
  id: 'run-1', ticketId: 't-1', templateId: 'tmpl-1',
  templateSnapshot: {
    name: 'Spec Dev PR', emoji: '📦',
    steps: [{ id: 'build', name: 'Build', executorType: 'agent', executorRef: 'p1', position: { x: 0, y: 0 } }],
    edges: [], entryStepId: 'build',
  },
  triggeredBy: '@nas', triggeredFrom: 'api',
});

const setup = () => {
  const run = makeRun(); // status 'running', currentStepId 'build'
  const orphan = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'build' });
  orphan.start(); // 'running' — the step left in flight by the crash
  const runStore = {
    getByStatus: vi.fn().mockImplementation(async (s: string) => (s === 'running' ? [run] : [])),
    save: vi.fn(),
  };
  const stepRunStore = { getByWorkflowRun: vi.fn().mockResolvedValue([orphan]), save: vi.fn() };
  const eventBus = { emit: vi.fn() };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const uc = new RecoverOrphanedWorkflowStepsUseCase(
    runStore as never, stepRunStore as never, eventBus as never, logger as never,
  );
  return { uc, run, orphan, runStore, stepRunStore, eventBus };
};

describe('RecoverOrphanedWorkflowStepsUseCase', () => {
  // WHY: a server restart interrupts a running step. The step is a genuine
  // casualty (mark it failed → the Retry panel appears), but the RUN is only
  // paused, not failed — parking it in needs_review makes the sidebar read
  // "needs you" instead of a misleading "idle".
  it('fails the orphaned step but PARKS the run in needs_review (not failed)', async () => {
    const { uc, run, orphan, stepRunStore, runStore } = setup();

    const result = await uc.execute();

    expect(orphan.status).toBe('failed');
    expect(orphan.output?.schemaFields['error']).toBe('Interrupted by server restart');
    expect(run.status).toBe('needs_review');
    expect(run.currentStepId).toBe('build'); // preserved for the "…› Build" label
    expect(stepRunStore.save).toHaveBeenCalledWith(orphan);
    expect(runStore.save).toHaveBeenCalledWith(run);
    expect(result).toEqual({ recoveredRuns: 1, recoveredStepRuns: 1 });
  });

  // WHY: the queue + workflow view need a live signal to flip to "needs you";
  // a needs_review event drives that (and the DAG reload that shows the failed step).
  it('emits one workflow.needs_review event for the parked run', async () => {
    const { uc, eventBus } = setup();

    await uc.execute();

    const events = eventBus.emit.mock.calls.map((c) => c[0]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'workflow.needs_review', workflowRunId: 'run-1', stepId: 'build', ticketId: 't-1',
    });
    // It must NOT report the run as failed.
    expect(events.some((e) => e.type === 'workflow.run_failed')).toBe(false);
  });

  it('does nothing for a run with no orphaned (running) step', async () => {
    const { uc, runStore, stepRunStore, eventBus } = setup();
    // A step that is not `running` (queued here) is not an orphan.
    const notRunning = StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'build' });
    stepRunStore.getByWorkflowRun.mockResolvedValue([notRunning]);

    const result = await uc.execute();

    expect(result).toEqual({ recoveredRuns: 0, recoveredStepRuns: 0 });
    expect(runStore.save).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});
