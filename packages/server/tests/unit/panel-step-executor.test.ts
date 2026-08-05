import { describe, it, expect, vi } from 'vitest';
import { PanelStepExecutor } from '../../src/application/services/step-executors/panel-step-executor.js';

describe('PanelStepExecutor', () => {
  it('calls runPanel with extra context + structured return', async () => {
    const runPanel = {
      execute: vi.fn().mockResolvedValue({
        structuredOutput: { deliverable: { title: 'Spec', markdown: '...', type: 'spec', status: 'final' }, comment: 'Approved by panel' },
        executionId: 'exec-1',
      }),
    };
    const exec = new PanelStepExecutor(runPanel as never, { get: () => ({}) } as never);
    const r = await exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'Spec Panel', executorType: 'panel', executorRef: 'les-big-tech', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'Spec Panel', outgoingEdges: [], previousOutputs: {} },
    });
    expect(runPanel.execute).toHaveBeenCalledWith(expect.objectContaining({
      panelName: 'les-big-tech', ticketId: 't-1', returnStructured: true,
      // The panel's own executions must carry the node they stand for, so the
      // Execution Log can be read back to a step of a run.
      workflowContext: expect.objectContaining({ runId: 'r-1', stepRunId: 'sr-1' }),
    }));
    expect(r.output.deliverable?.title).toBe('Spec');
    expect(r.output.result).toBe('ok');
  });
});
