import { describe, it, expect, vi } from 'vitest';
import { SkillStepExecutor } from '../../src/application/services/step-executors/skill-step-executor.js';

describe('SkillStepExecutor', () => {
  it('resolves skill by commandName and maps result to StepOutput', async () => {
    const skillStore = {
      getByCommandName: vi.fn().mockResolvedValue({ id: 'sk-1', commandName: 'doc-writer' }),
    };
    const executeAgent = {
      executeForSkill: vi.fn().mockResolvedValue({
        structuredOutput: { deliverable: { title: 'Doc', markdown: '...', type: 'spec', status: 'final' }, comment: null },
        rawText: '', executionId: 'exec-1',
      }),
    };
    const exec = new SkillStepExecutor(executeAgent as never, skillStore as never);
    const r = await exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'Doc Update', executorType: 'skill', executorRef: 'doc-writer', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'Doc Update', outgoingEdges: [], previousOutputs: {} },
    });
    expect(skillStore.getByCommandName).toHaveBeenCalledWith('doc-writer');
    expect(r.output.deliverable?.title).toBe('Doc');
    expect(r.output.result).toBe('ok');
  });

  it('throws when skill is not found', async () => {
    const skillStore = { getByCommandName: vi.fn().mockResolvedValue(null) };
    const exec = new SkillStepExecutor({} as never, skillStore as never);
    await expect(exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'X', executorType: 'skill', executorRef: 'missing', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'X', outgoingEdges: [], previousOutputs: {} },
    })).rejects.toThrow(/skill .* not found/);
  });
});
