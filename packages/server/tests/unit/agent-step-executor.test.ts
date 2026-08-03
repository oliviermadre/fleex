import { describe, it, expect, vi } from 'vitest';

import { AgentStepExecutor } from '../../src/application/services/step-executors/agent-step-executor.js';

describe('AgentStepExecutor', () => {
  it('calls executeForWorkflowStep and maps result to StepOutput', async () => {
    const executeAgent = {
      executeForWorkflowStep: vi.fn().mockResolvedValue({
        structuredOutput: {
          deliverable: null,
          comment: 'Triaged',
          path: 'standard',
          priority: 'high',
        },
        rawText: '',
        executionId: 'exec-1',
      }),
    };
    const exec = new AgentStepExecutor(executeAgent as never);
    const r = await exec.execute({
      ticketId: 't-1',
      workflowRunId: 'r-1',
      stepRunId: 'sr-1',
      step: {
        id: 's1',
        name: 'Triage',
        executorType: 'agent',
        executorRef: 'the-sentinel',
        mode: 'plan',
        outputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        position: { x: 0, y: 0 },
      },
      workflowContext: {
        workflowName: 'W',
        stepName: 'Triage',
        outgoingEdges: [],
        previousOutputs: {},
      },
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
        structuredOutput: {
          deliverable: null,
          comment: 'I need clarification',
          mentionStatus: 'waiting_for_info',
        },
        rawText: '',
        executionId: 'exec-2',
      }),
    };
    const exec = new AgentStepExecutor(executeAgent as never);
    const r = await exec.execute({
      ticketId: 't-1',
      workflowRunId: 'r-1',
      stepRunId: 'sr-1',
      step: {
        id: 's1',
        name: 'X',
        executorType: 'agent',
        executorRef: 'p',
        position: { x: 0, y: 0 },
      },
      workflowContext: { workflowName: 'W', stepName: 'X', outgoingEdges: [], previousOutputs: {} },
    });
    expect(r.output.result).toBe('needs_review');
  });

  it('marks result=ko when SDK returns no structured output', async () => {
    const executeAgent = {
      executeForWorkflowStep: vi.fn().mockResolvedValue({
        structuredOutput: null,
        rawText: 'plain text fallback',
        executionId: 'exec-3',
      }),
    };
    const exec = new AgentStepExecutor(executeAgent as never);
    const r = await exec.execute({
      ticketId: 't-1',
      workflowRunId: 'r-1',
      stepRunId: 'sr-1',
      step: {
        id: 's1',
        name: 'X',
        executorType: 'agent',
        executorRef: 'p',
        position: { x: 0, y: 0 },
      },
      workflowContext: { workflowName: 'W', stepName: 'X', outgoingEdges: [], previousOutputs: {} },
    });
    expect(r.output.result).toBe('ko');
  });
});
