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
    const exec = new SkillStepExecutor(executeAgent as never, skillStore as never, {} as never, { get: () => ({}) } as never);
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
    const exec = new SkillStepExecutor({} as never, skillStore as never, {} as never, { get: () => ({}) } as never);
    await expect(exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'X', executorType: 'skill', executorRef: 'missing', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'X', outgoingEdges: [], previousOutputs: {} },
    })).rejects.toThrow(/skill .* not found/);
  });
  it('keeps sanitized questions on a waiting step, out of schemaFields', async () => {
    const skillStore = { getByCommandName: vi.fn().mockResolvedValue({ id: 'sk-1', commandName: 'doc-writer' }) };
    const executeAgent = {
      executeForSkill: vi.fn().mockResolvedValue({
        structuredOutput: {
          deliverable: null, comment: 'Which?', mentionStatus: 'waiting_for_info',
          questions: [{ prompt: 'Repo ?', options: ['fleex', 'odys', 9] }],
        },
        rawText: '', executionId: 'exec-q',
      }),
    };
    const exec = new SkillStepExecutor(executeAgent as never, skillStore as never, {} as never, { get: () => ({}) } as never);
    const r = await exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'Doc', executorType: 'skill', executorRef: 'doc-writer', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'Doc', outgoingEdges: [], previousOutputs: {} },
    });
    expect(r.output.questions).toEqual([{ prompt: 'Repo ?', options: ['fleex', 'odys'] }]);
    expect(r.output.schemaFields).not.toHaveProperty('questions');
  });

  it('runs the skill on the station\'s model when one is given, on a ticket and in a routine alike', async () => {
    const skillStore = { getByCommandName: vi.fn().mockResolvedValue({ id: 'sk-1', commandName: 'review', personaId: 'p-1', displayName: 'Review', markdownContent: 'Review it.' }) };
    const executeAgent = {
      executeForSkill: vi.fn().mockResolvedValue({ structuredOutput: { deliverable: null, comment: 'ok' }, rawText: '', executionId: 'e-1' }),
      executeForWorkflowStep: vi.fn().mockResolvedValue({ structuredOutput: { deliverable: null, comment: 'ok' }, rawText: '', executionId: 'e-2' }),
    };
    const personaStore = { getById: vi.fn().mockResolvedValue({ id: 'p-1', name: 'builder', model: 'claude-opus-5-5' }) };
    const exec = new SkillStepExecutor(executeAgent as never, skillStore as never, personaStore as never, { get: () => ({}) } as never);
    const base = {
      workflowRunId: 'r-1', stepRunId: 'sr-1', modelOverride: 'claude-haiku-5-5',
      step: { id: 's1', name: 'Review', executorType: 'skill' as const, executorRef: 'review', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'Factory', stepName: 'Review', outgoingEdges: [], previousOutputs: {} },
    };
    await exec.execute({ ...base, ticketId: 't-1' });
    await exec.execute({ ...base, ticketId: null as never });
    expect(executeAgent.executeForSkill).toHaveBeenCalledWith('sk-1', 't-1', expect.objectContaining({ model: 'claude-haiku-5-5' }));
    expect(executeAgent.executeForWorkflowStep).toHaveBeenCalledWith(expect.objectContaining({ personaName: 'builder', model: 'claude-haiku-5-5' }));
  });
});
