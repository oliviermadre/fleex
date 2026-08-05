import { describe, it, expect, vi } from 'vitest';
import { AgentStepExecutor } from '../../src/application/services/step-executors/agent-step-executor.js';

/** Config stub. `deliverableTypes` defaults to the workspace preset. */
function config(deliverableTypes?: { id: string; description: string }[]) {
  return { get: () => ({ deliverableTypes }) };
}

describe('AgentStepExecutor', () => {
  it('calls executeForWorkflowStep and maps result to StepOutput', async () => {
    const executeAgent = {
      executeForWorkflowStep: vi.fn().mockResolvedValue({
        structuredOutput: { deliverable: null, comment: 'Triaged', path: 'standard', priority: 'high' },
        rawText: '',
        executionId: 'exec-1',
      }),
    };
    const exec = new AgentStepExecutor(executeAgent as never, config() as never);
    const r = await exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'Triage', executorType: 'agent', executorRef: 'the-sentinel', mode: 'plan',
              outputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
              position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'Triage', outgoingEdges: [], previousOutputs: {} },
    });
    expect(r.executionId).toBe('exec-1');
    expect(r.output.comment).toBe('Triaged');
    expect(r.output.schemaFields.path).toBe('standard');
    expect(r.output.schemaFields.priority).toBe('high');
    expect(r.output.result).toBe('ok');
  });

  it('marks result=needs_review when mentionStatus=waiting_for_info', async () => {
    const executeAgent = {
      executeForWorkflowStep: vi.fn().mockResolvedValue({
        structuredOutput: { deliverable: null, comment: 'I need clarification', mentionStatus: 'waiting_for_info' },
        rawText: '', executionId: 'exec-2',
      }),
    };
    const exec = new AgentStepExecutor(executeAgent as never, config() as never);
    const r = await exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'X', executorType: 'agent', executorRef: 'p', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'X', outgoingEdges: [], previousOutputs: {} },
    });
    expect(r.output.result).toBe('needs_review');
  });

  it('marks result=ko when SDK returns no structured output', async () => {
    const executeAgent = {
      executeForWorkflowStep: vi.fn().mockResolvedValue({
        structuredOutput: null, rawText: 'plain text fallback', executionId: 'exec-3',
      }),
    };
    const exec = new AgentStepExecutor(executeAgent as never, config() as never);
    const r = await exec.execute({
      ticketId: 't-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'X', executorType: 'agent', executorRef: 'p', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'X', outgoingEdges: [], previousOutputs: {} },
    });
    expect(r.output.result).toBe('ko');
  });

  // A step used to be handed the legacy preset, so a workspace-specific type
  // (say `fireflies`) was unreachable: the schema enum refused it and the CLI
  // hint showed a hard-coded example type. The agent then filed a `report`
  // because that was the only thing it had been offered.
  it('offers the workspace deliverable types, not the built-in preset', async () => {
    const executeAgent = {
      executeForWorkflowStep: vi.fn().mockResolvedValue({
        structuredOutput: { deliverable: null, comment: null }, rawText: '', executionId: 'exec-4',
      }),
    };
    const exec = new AgentStepExecutor(
      executeAgent as never,
      config([{ id: 'fireflies', description: 'A meeting transcript' }]) as never,
    );
    await exec.execute({
      ticketId: null, routineId: 'ro-1', workflowRunId: 'r-1', stepRunId: 'sr-1',
      step: { id: 's1', name: 'X', executorType: 'agent', executorRef: 'p', position: { x: 0, y: 0 } },
      workflowContext: { workflowName: 'W', stepName: 'X', outgoingEdges: [], previousOutputs: {} },
    });

    const call = executeAgent.executeForWorkflowStep.mock.calls[0][0];
    expect(call.outputFormat.schema.properties.deliverable.oneOf[0].properties.type.enum)
      .toEqual(['fireflies']);
    expect(call.workflowContextPrompt).toContain('`fireflies`');
    // The step also has to know which attempt it is, or it cannot address
    // itself from the CLI — and the header cannot name the node being debugged.
    expect(call.stepRunId).toBe('sr-1');
  });
});
