import { describe, it, expect } from 'vitest';
import { deriveTicketAgentActivity } from '../../src/domain/services/ticket-agent-activity.js';

const EMPTY = {
  runningExecutionTicketIds: [],
  runningWorkflowTicketIds: [],
  waitingMentionTicketIds: [],
  waitingWorkflowTicketIds: [],
};

describe('deriveTicketAgentActivity', () => {
  it('marks a ticket running when an AgentExecution is running (spec AC1)', () => {
    const [t] = deriveTicketAgentActivity(['T1'], { ...EMPTY, runningExecutionTicketIds: ['T1'] });
    expect(t?.activity).toBe('running');
  });

  it('marks a ticket running when a WorkflowRun is running (spec AC1)', () => {
    const [t] = deriveTicketAgentActivity(['T1'], { ...EMPTY, runningWorkflowTicketIds: ['T1'] });
    expect(t?.activity).toBe('running');
  });

  it('marks a ticket waiting when a mention is waiting_for_info (spec AC2)', () => {
    const [t] = deriveTicketAgentActivity(['T1'], { ...EMPTY, waitingMentionTicketIds: ['T1'] });
    expect(t?.activity).toBe('waiting');
  });

  it('marks a ticket waiting when a WorkflowRun sits at a human gate (spec AC2)', () => {
    const [t] = deriveTicketAgentActivity(['T1'], { ...EMPTY, waitingWorkflowTicketIds: ['T1'] });
    expect(t?.activity).toBe('waiting');
  });

  it('gives waiting precedence over running when both apply (spec AC3)', () => {
    // WHY: the pill is single-state and the human-gate state is the actionable one.
    // A ticket that is both executing an agent AND has an unanswered question must
    // surface "waiting" — never both pills, never the less-urgent "running".
    const [t] = deriveTicketAgentActivity(['T1'], {
      ...EMPTY,
      runningExecutionTicketIds: ['T1'],
      runningWorkflowTicketIds: ['T1'],
      waitingMentionTicketIds: ['T1'],
    });
    expect(t?.activity).toBe('waiting');
  });

  it('defaults to idle for a requested ticket with no agentic activity (spec AC4)', () => {
    // WHY: the manual `ticket.blocked` flag is deliberately not a source; an idle
    // ticket (even a blocked one) must report idle so no pill renders.
    const [t] = deriveTicketAgentActivity(['T1'], EMPTY);
    expect(t?.activity).toBe('idle');
    expect(t?.detail).toBeUndefined();
  });

  it('returns exactly one entry per requested id, ignoring active tickets not requested', () => {
    // WHY: the endpoint is a bulk board-scoped query; it must answer only for the
    // visible tickets it was asked about and must not leak activity for others.
    const result = deriveTicketAgentActivity(['T1', 'T2'], {
      ...EMPTY,
      runningExecutionTicketIds: ['T1', 'T3'],
      waitingMentionTicketIds: ['T2'],
    });
    expect(result.map((r) => r.ticketId)).toEqual(['T1', 'T2']);
    expect(result.find((r) => r.ticketId === 'T1')?.activity).toBe('running');
    expect(result.find((r) => r.ticketId === 'T2')?.activity).toBe('waiting');
    expect(result.some((r) => r.ticketId === 'T3')).toBe(false);
  });

  it('returns an empty array when no tickets are requested', () => {
    expect(deriveTicketAgentActivity([], { ...EMPTY, runningExecutionTicketIds: ['T1'] })).toEqual([]);
  });

  it('attaches a human-readable detail for non-idle states (drives the card tooltip)', () => {
    const [running] = deriveTicketAgentActivity(['T1'], { ...EMPTY, runningExecutionTicketIds: ['T1'] });
    const [waiting] = deriveTicketAgentActivity(['T2'], { ...EMPTY, waitingMentionTicketIds: ['T2'] });
    expect(running?.detail).toBeTruthy();
    expect(waiting?.detail).toBeTruthy();
  });

  it('carries lastActivityAt from the SDK-activity map for every state (#400, pass 4)', () => {
    // WHY: the cockpit shows "idle since {{age}}" per row — the timestamp of
    // the last SDK execution must ride along with the activity entry, idle
    // included (that is exactly the state that needs it).
    const lastSdkActivityAtByTicket = new Map([
      ['T1', '2026-07-17T10:00:00.000Z'],
      ['T2', '2026-07-16T08:00:00.000Z'],
    ]);
    const result = deriveTicketAgentActivity(['T1', 'T2'], {
      ...EMPTY,
      runningExecutionTicketIds: ['T1'],
      lastSdkActivityAtByTicket,
    });
    expect(result.find((r) => r.ticketId === 'T1')?.lastActivityAt).toBe('2026-07-17T10:00:00.000Z');
    const idle = result.find((r) => r.ticketId === 'T2');
    expect(idle?.activity).toBe('idle');
    expect(idle?.lastActivityAt).toBe('2026-07-16T08:00:00.000Z');
  });

  it('omits lastActivityAt when a ticket never had an SDK session (renders plain "idle")', () => {
    const [withMap] = deriveTicketAgentActivity(['T1'], {
      ...EMPTY,
      lastSdkActivityAtByTicket: new Map(),
    });
    expect(withMap?.lastActivityAt).toBeUndefined();

    const [withoutMap] = deriveTicketAgentActivity(['T1'], EMPTY);
    expect(withoutMap?.lastActivityAt).toBeUndefined();
  });
});
