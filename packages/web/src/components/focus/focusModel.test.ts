import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FocusItem } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  resolveWorkflowGate: vi.fn().mockResolvedValue(undefined),
  resolveWorkflowRoute: vi.fn().mockResolvedValue(undefined),
  retryWorkflowStep: vi.fn().mockResolvedValue(undefined),
  runMention: vi.fn().mockResolvedValue(undefined),
  postTicketComment: vi.fn().mockResolvedValue(undefined),
}));

import * as api from '../../services/api';
import { answerQuestion, focusActions, formatWait, questionOptions, sortFocusItems } from './focusModel';

const base: FocusItem = {
  key: 'k', kind: 'gate', ticketId: 'T1', since: null, workflow: null, gate: null, question: null,
  error: null, idle: null, lastAgentComment: null, costUsd: 0,
};
const ctx = { ticket: { id: 'T1', displayId: 42, status: 'doing' as const }, moveTicket: vi.fn().mockResolvedValue(undefined) };

describe('focusActions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gate outcomes resolve the gate, primary first, with the typed comment', async () => {
    const item: FocusItem = {
      ...base,
      gate: { runId: 'r', stepRunId: 's', stepName: 'Validate', mode: 'outcome', context: null, options: [
        { value: 'approve', label: 'approve', targetStepName: 'Build' },
        { value: 'rework', label: 'rework', targetStepName: null },
      ] },
    };
    const [a, b] = focusActions(item, ctx);
    expect(a).toMatchObject({ label: 'approve', hint: '→ Build', primary: true });
    expect(b!.primary).toBe(false);
    await a!.run('looks good');
    expect(api.resolveWorkflowGate).toHaveBeenCalledWith('r', 's', { outcome: 'approve', notes: 'looks good' });
  });

  it('route choices resolve the route by edge id', async () => {
    const item: FocusItem = {
      ...base,
      gate: { runId: 'r', stepRunId: 's', stepName: 'Route', mode: 'route', context: null, options: [{ value: 'e2', label: 'Build', targetStepName: 'Build' }] },
    };
    await focusActions(item, ctx)[0]!.run();
    expect(api.resolveWorkflowRoute).toHaveBeenCalledWith('r', 's', { edgeId: 'e2', notes: undefined });
  });

  it('a single declared question offers its options, answered as a comment', async () => {
    const item: FocusItem = {
      ...base, kind: 'question',
      question: {
        source: 'mention', mentionId: 'm', runId: null, stepRunId: null, askedBy: 'Dev', text: 'Where?',
        questions: [{ prompt: 'Scope ?', options: ['Global', 'Per board'] }],
      },
    };
    expect(questionOptions(item)).toEqual(['Global', 'Per board']);
    const actions = focusActions(item, ctx);
    expect(actions.map((a) => a.label)).toEqual(['Global', 'Per board']);
    await actions[1]!.run();
    expect(api.postTicketComment).toHaveBeenCalledWith('T1', 'Per board');
  });

  it('offers no buttons without declared questions, even when the text lists options', () => {
    const item: FocusItem = {
      ...base, kind: 'question',
      question: { source: 'mention', mentionId: 'm', runId: null, stepRunId: null, askedBy: 'Dev', text: 'Where?\n- Global\n- Per board' },
    };
    expect(questionOptions(item)).toEqual([]);
  });

  it('offers no buttons for several questions (answered from the detail view)', () => {
    const item: FocusItem = {
      ...base, kind: 'question',
      question: {
        source: 'mention', mentionId: 'm', runId: null, stepRunId: null, askedBy: 'Dev', text: 'Two things',
        questions: [
          { prompt: 'A ?', options: ['1', '2'] },
          { prompt: 'B ?', options: ['3', '4'] },
        ],
      },
    };
    expect(questionOptions(item)).toEqual([]);
  });

  it('a paused step question is answered with a comment then a retry carrying the answer', async () => {
    const item: FocusItem = {
      ...base, kind: 'question',
      question: { source: 'step', mentionId: null, runId: 'r', stepRunId: 's', askedBy: 'Plan', text: 'Which repo?' },
    };
    await answerQuestion(item, 'fleex');
    expect(api.postTicketComment).toHaveBeenCalledWith('T1', 'fleex');
    expect(api.retryWorkflowStep).toHaveBeenCalledWith('r', 's', 'fleex');
  });

  it('errors retry the step or relaunch the crashed mention', async () => {
    const step: FocusItem = { ...base, kind: 'error', error: { source: 'step', runId: 'r', stepRunId: 's', mentionId: null, label: 'Build', message: null, executionId: null } };
    await focusActions(step, ctx)[0]!.run();
    expect(api.retryWorkflowStep).toHaveBeenCalledWith('r', 's');

    const crash: FocusItem = { ...base, kind: 'error', error: { source: 'mention', runId: null, stepRunId: null, mentionId: 'm', label: 'Dev', message: null, executionId: 'x' } };
    await focusActions(crash, ctx)[0]!.run();
    expect(api.runMention).toHaveBeenCalledWith('m');
  });

  it('idle tickets move one step forward, never relaunch their agent without a comment', async () => {
    const item: FocusItem = { ...base, kind: 'idle', idle: { lastActivityAt: null, lastAgentName: 'dev', lastAgentDisplayName: 'Dev' } };
    const [advance, ...rest] = focusActions(item, ctx);
    expect(rest).toEqual([]);
    expect(advance!.label).toBe('Passer en Reviewing');
    await advance!.run();
    expect(ctx.moveTicket).toHaveBeenCalledWith('T1', 'reviewing');

    const never: FocusItem = { ...item, idle: { lastActivityAt: null, lastAgentName: null, lastAgentDisplayName: null } };
    expect(focusActions(never, ctx).map((a) => [a.label, a.primary])).toEqual([['Passer en Reviewing', true]]);
  });

  it('never offers Done to a Doing ticket: Doing → Reviewing, Reviewing → Done', () => {
    const item: FocusItem = { ...base, kind: 'idle', idle: { lastActivityAt: null, lastAgentName: null, lastAgentDisplayName: null } };
    const labels = (status: 'doing' | 'reviewing') => focusActions(item, { ...ctx, ticket: { ...ctx.ticket, status } }).map((a) => a.label);
    expect(labels('doing')).toEqual(['Passer en Reviewing']);
    expect(labels('reviewing')).toEqual(['Passer en Done']);
  });
});

describe('formatWait', () => {
  it('reads like a duration', () => {
    expect(formatWait(null)).toBe('—');
    expect(formatWait(20_000)).toBe('à l’instant');
    expect(formatWait(12 * 60_000)).toBe('12 min');
    expect(formatWait(125 * 60_000)).toBe('2 h 05');
    expect(formatWait(3 * 3600_000)).toBe('3 h');
    expect(formatWait(28 * 3600_000)).toBe('1 j 4 h');
  });
});

describe('sortFocusItems', () => {
  const a = { ...base, key: 'a', kind: 'idle' as const, ticketId: 'A', since: '2026-09-28T08:00:00Z' };
  const b = { ...base, key: 'b', kind: 'gate' as const, ticketId: 'B', since: '2026-09-28T09:00:00Z' };
  const c = { ...base, key: 'c', kind: 'error' as const, ticketId: 'C', since: null };
  const prio = new Map([['A', { priority: 'low' as const }], ['B', { priority: 'high' as const }], ['C', { priority: 'high' as const }]]);

  it('oldest first, unknown ages last', () => {
    expect(sortFocusItems([c, b, a], 'age', prio).map((i) => i.key)).toEqual(['a', 'b', 'c']);
  });
  it('by priority, then age', () => {
    expect(sortFocusItems([a, c, b], 'priority', prio).map((i) => i.key)).toEqual(['b', 'c', 'a']);
  });
  it('by kind', () => {
    expect(sortFocusItems([a, c, b], 'kind', prio).map((i) => i.key)).toEqual(['b', 'c', 'a']);
  });
});
