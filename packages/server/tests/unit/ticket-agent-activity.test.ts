import { describe, it, expect } from 'vitest';

import {
  deriveTicketAgentActivity,
  deriveActivitySince,
} from '../../src/domain/services/ticket-agent-activity.js';

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
    expect(deriveTicketAgentActivity([], { ...EMPTY, runningExecutionTicketIds: ['T1'] })).toEqual(
      [],
    );
  });

  it('attaches a human-readable detail for non-idle states (drives the card tooltip)', () => {
    const [running] = deriveTicketAgentActivity(['T1'], {
      ...EMPTY,
      runningExecutionTicketIds: ['T1'],
    });
    const [waiting] = deriveTicketAgentActivity(['T2'], {
      ...EMPTY,
      waitingMentionTicketIds: ['T2'],
    });
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
    expect(result.find((r) => r.ticketId === 'T1')?.lastActivityAt).toBe(
      '2026-07-17T10:00:00.000Z',
    );
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

  // ── `since` — when the CURRENT state began (#400, pass 5) ──
  // WHY: NaS wants the duration on EVERY badge — "Running for 5m" and
  // "Waiting for 2h" matter as much as "idle for 3h". The entry must carry the
  // start of the current state, per state.

  it('carries since for a running ticket from the running-since map (pass 5)', () => {
    const [t] = deriveTicketAgentActivity(['T1'], {
      ...EMPTY,
      runningExecutionTicketIds: ['T1'],
      runningSinceByTicket: new Map([['T1', '2026-07-17T11:00:00.000Z']]),
    });
    expect(t?.activity).toBe('running');
    expect(t?.since).toBe('2026-07-17T11:00:00.000Z');
  });

  it('carries since for a waiting ticket from the waiting-since map — not the running one', () => {
    // WHY: waiting wins the precedence, so its duration must too. Showing the
    // running start under a Waiting pill would misstate how long the human has
    // been blocking.
    const [t] = deriveTicketAgentActivity(['T1'], {
      ...EMPTY,
      runningExecutionTicketIds: ['T1'],
      waitingMentionTicketIds: ['T1'],
      runningSinceByTicket: new Map([['T1', '2026-07-17T09:00:00.000Z']]),
      waitingSinceByTicket: new Map([['T1', '2026-07-17T11:30:00.000Z']]),
    });
    expect(t?.activity).toBe('waiting');
    expect(t?.since).toBe('2026-07-17T11:30:00.000Z');
  });

  it('for idle tickets, since IS the last SDK activity ("idle for {{age}}")', () => {
    const [t] = deriveTicketAgentActivity(['T1'], {
      ...EMPTY,
      lastSdkActivityAtByTicket: new Map([['T1', '2026-07-17T08:00:00.000Z']]),
    });
    expect(t?.activity).toBe('idle');
    expect(t?.since).toBe('2026-07-17T08:00:00.000Z');
  });

  it('omits since when the state start is unknown (no maps provided)', () => {
    const [running] = deriveTicketAgentActivity(['T1'], {
      ...EMPTY,
      runningExecutionTicketIds: ['T1'],
    });
    expect(running?.since).toBeUndefined();
    const [idle] = deriveTicketAgentActivity(['T2'], EMPTY);
    expect(idle?.since).toBeUndefined();
  });

  // ── cumulativeCostUsd — the ticket's total agentic spend (#404) ──
  // WHY: the Kanban card shows a coloured cost badge. The cost must ride along
  // with the activity entry for EVERY state, since a finished (idle) ticket is
  // exactly the one whose accumulated cost matters most.

  it('carries the cumulative cost from the cost map, for running and idle alike (#404)', () => {
    const costByTicket = new Map([
      ['T1', 3.47],
      ['T2', 23.5],
    ]);
    const result = deriveTicketAgentActivity(['T1', 'T2'], {
      ...EMPTY,
      runningExecutionTicketIds: ['T1'],
      costByTicket,
    });
    expect(result.find((r) => r.ticketId === 'T1')?.cumulativeCostUsd).toBe(3.47);
    const idle = result.find((r) => r.ticketId === 'T2');
    expect(idle?.activity).toBe('idle');
    expect(idle?.cumulativeCostUsd).toBe(23.5); // idle ticket still reports its cost
  });

  it('reports cumulativeCostUsd = 0 when a ticket has no cost / no map (never omitted)', () => {
    // WHY: the field is always present (0 ⇒ no badge). A missing map or a ticket
    // absent from it must read as 0, not undefined.
    const [withMap] = deriveTicketAgentActivity(['T1'], {
      ...EMPTY,
      costByTicket: new Map([['T2', 5]]),
    });
    expect(withMap?.cumulativeCostUsd).toBe(0);

    const [withoutMap] = deriveTicketAgentActivity(['T1'], EMPTY);
    expect(withoutMap?.cumulativeCostUsd).toBe(0);
  });
});

describe('deriveActivitySince', () => {
  const EMPTY_INPUTS = {
    runningExecutions: [],
    runningWorkflowRuns: [],
    waitingMentions: [],
    executionCompletedAtByMentionId: new Map<string, string>(),
    gateWorkflowRuns: [],
  };

  it('running since = earliest start among in-flight executions and workflow runs', () => {
    // WHY: "Running for X" is the duration of the ongoing burst of work — with
    // overlapping runs, the oldest still-running start is when the state began.
    const { runningSinceByTicket } = deriveActivitySince({
      ...EMPTY_INPUTS,
      runningExecutions: [
        { ticketId: 'T1', startedAt: '2026-07-17T10:30:00.000Z' },
        { ticketId: 'T1', startedAt: '2026-07-17T10:00:00.000Z' },
      ],
      runningWorkflowRuns: [{ ticketId: 'T1', startedAt: '2026-07-17T11:00:00.000Z' }],
    });
    expect(runningSinceByTicket.get('T1')).toBe('2026-07-17T10:00:00.000Z');
  });

  it('waiting since for a mention = completedAt of the execution that asked (the moment the question was posed)', () => {
    const { waitingSinceByTicket } = deriveActivitySince({
      ...EMPTY_INPUTS,
      waitingMentions: [{ ticketId: 'T1', id: 'M1', createdAt: '2026-07-17T09:00:00.000Z' }],
      executionCompletedAtByMentionId: new Map([['M1', '2026-07-17T09:45:00.000Z']]),
    });
    expect(waitingSinceByTicket.get('T1')).toBe('2026-07-17T09:45:00.000Z');
  });

  it('waiting since falls back to the mention createdAt when no execution carried it', () => {
    // WHY: a mention flipped to waiting_for_info via the API has no linked
    // execution — better a slightly-early timestamp than no duration at all.
    const { waitingSinceByTicket } = deriveActivitySince({
      ...EMPTY_INPUTS,
      waitingMentions: [{ ticketId: 'T1', id: 'M1', createdAt: '2026-07-17T09:00:00.000Z' }],
    });
    expect(waitingSinceByTicket.get('T1')).toBe('2026-07-17T09:00:00.000Z');
  });

  it('waiting since for a human gate = the workflow run updatedAt, earliest source wins per ticket', () => {
    const { waitingSinceByTicket } = deriveActivitySince({
      ...EMPTY_INPUTS,
      waitingMentions: [{ ticketId: 'T1', id: 'M1', createdAt: '2026-07-17T10:00:00.000Z' }],
      gateWorkflowRuns: [{ ticketId: 'T1', updatedAt: '2026-07-17T08:00:00.000Z' }],
    });
    expect(waitingSinceByTicket.get('T1')).toBe('2026-07-17T08:00:00.000Z');
  });

  it('returns empty maps for empty inputs', () => {
    const { runningSinceByTicket, waitingSinceByTicket } = deriveActivitySince(EMPTY_INPUTS);
    expect(runningSinceByTicket.size).toBe(0);
    expect(waitingSinceByTicket.size).toBe(0);
  });
});
