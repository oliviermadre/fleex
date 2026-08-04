import { describe, it, expect, beforeEach } from 'vitest';
import { BroadcastRegistrar } from '../../src/application/broadcast-registrar.js';
import { EventBus } from '../../src/application/event-bus.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';

// ---------------------------------------------------------------------------
// A routine run has no ticket, so `ticketId` is null on every `workflow:*` push
// it produces. The Routines screen therefore had no way to tell which of those
// pushes concerned the routine the user is looking at — and the screen simply
// never updated: steps stayed "running" after they finished, a human gate never
// appeared, the gate panel never closed once resolved. The only workaround was
// reloading the page by hand.
//
// The fix is one field: every workflow broadcast carries BOTH anchors. These
// tests pin it down, because dropping `routineId` from any single payload
// silently kills reactivity for that transition again.
// ---------------------------------------------------------------------------

const ROUTINE = 'r-1';

function fixture() {
  const bus = new EventBus();
  const sent: { type: string; data: Record<string, unknown> }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registrar = new BroadcastRegistrar({} as any);
  registrar.setTicketBroadcast((type, data) => sent.push({ type, data: data as Record<string, unknown> }));
  registrar.register(bus);
  return { bus, sent };
}

/** The workflow events a routine run walks through, from creation to end. */
const ROUTINE_RUN_EVENTS: { event: AnyDomainEvent; wsType: string }[] = [
  {
    wsType: 'workflow:run_created',
    event: {
      type: 'workflow.run_created', workflowRunId: 'w1', templateId: 't1',
      ticketId: null, routineId: ROUTINE, occurredAt: new Date(),
    },
  },
  {
    wsType: 'workflow:step_started',
    event: {
      type: 'workflow.step_started', workflowRunId: 'w1', stepRunId: 's1', stepId: 'a',
      ticketId: null, routineId: ROUTINE, occurredAt: new Date(),
    },
  },
  {
    wsType: 'workflow:step_completed',
    event: {
      type: 'workflow.step_completed', workflowRunId: 'w1', stepRunId: 's1', stepId: 'a',
      ticketId: null, routineId: ROUTINE, nextEdgeId: 'e1', occurredAt: new Date(),
    },
  },
  {
    wsType: 'workflow:step_cancelled',
    event: {
      type: 'workflow.step_cancelled', workflowRunId: 'w1', stepRunId: 's1', stepId: 'a',
      ticketId: null, routineId: ROUTINE, occurredAt: new Date(),
    },
  },
  // The one that made the "waiting" badge and the gate panel unreachable.
  {
    wsType: 'workflow:needs_review',
    event: {
      type: 'workflow.needs_review', workflowRunId: 'w1', stepRunId: 's1', stepId: 'a',
      ticketId: null, routineId: ROUTINE, occurredAt: new Date(),
    },
  },
  {
    wsType: 'workflow:awaiting_routing',
    event: {
      type: 'workflow.awaiting_routing', workflowRunId: 'w1', stepRunId: 's1', stepId: 'a',
      ticketId: null, routineId: ROUTINE, candidateEdgeIds: ['e1', 'e2'], occurredAt: new Date(),
    },
  },
  {
    wsType: 'workflow:run_completed',
    event: {
      type: 'workflow.run_completed', workflowRunId: 'w1',
      ticketId: null, routineId: ROUTINE, occurredAt: new Date(),
    },
  },
  {
    wsType: 'workflow:run_failed',
    event: {
      type: 'workflow.run_failed', workflowRunId: 'w1', stepRunId: 's1', stepId: 'a',
      ticketId: null, routineId: ROUTINE, error: 'boom', occurredAt: new Date(),
    },
  },
  {
    wsType: 'workflow:run_cancelled',
    event: {
      type: 'workflow.run_cancelled', workflowRunId: 'w1',
      ticketId: null, routineId: ROUTINE, occurredAt: new Date(),
    },
  },
];

describe('workflow broadcasts — routine anchor', () => {
  let bus: EventBus;
  let sent: { type: string; data: Record<string, unknown> }[];

  beforeEach(() => {
    ({ bus, sent } = fixture());
  });

  it.each(ROUTINE_RUN_EVENTS)('$wsType carries routineId', ({ event, wsType }) => {
    bus.emit(event);
    const msg = sent.find((m) => m.type === wsType);
    expect(msg, `${wsType} was not broadcast at all`).toBeDefined();
    expect(msg!.data.routineId).toBe(ROUTINE);
    expect(msg!.data.ticketId).toBeNull();
  });

  it('leaves ticket runs with an explicitly null routine anchor', () => {
    // The client discriminates on truthiness; `undefined` would work today but
    // would silently start matching if the field were ever spread from a
    // partially-typed source. Null is the contract.
    bus.emit({
      type: 'workflow.step_completed', workflowRunId: 'w1', stepRunId: 's1', stepId: 'a',
      ticketId: 'ticket-1', nextEdgeId: null, occurredAt: new Date(),
    });
    const msg = sent.find((m) => m.type === 'workflow:step_completed')!;
    expect(msg.data.ticketId).toBe('ticket-1');
    expect(msg.data.routineId).toBeNull();
  });
});
