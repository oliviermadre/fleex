import { describe, it, expect } from 'vitest';
import type { AgentExecution } from '@fleex/shared';
import {
  mineAutomationCandidates,
  resolveCandidateTargets,
  suggestCron,
  groupKey,
  MIN_OCCURRENCES,
} from '../../src/application/services/automation-mining.js';

const NOW = new Date('2026-08-13T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function execution(overrides: Partial<AgentExecution> & { startedAt: string }): AgentExecution {
  return {
    id: `e-${overrides.startedAt}`,
    personaId: 'p1',
    ticketId: 't1',
    mentionId: 'skill:daily-recap',
    eventCount: 1,
    status: 'completed',
    completedAt: overrides.startedAt,
    lastEventAt: overrides.startedAt,
    ...overrides,
  } as AgentExecution;
}

/** `count` runs ending now, spaced `gapMs` apart. */
function series(count: number, gapMs: number, overrides: Partial<AgentExecution> = {}): AgentExecution[] {
  return Array.from({ length: count }, (_, i) =>
    execution({ ...overrides, startedAt: new Date(NOW.getTime() - (count - 1 - i) * gapMs).toISOString() }));
}

/** Three runs in one afternoon a month ago, then one yesterday. */
const BURST = [
  execution({ startedAt: new Date(NOW.getTime() - 30 * DAY).toISOString() }),
  execution({ startedAt: new Date(NOW.getTime() - 30 * DAY + HOUR).toISOString() }),
  execution({ startedAt: new Date(NOW.getTime() - 30 * DAY + 2 * HOUR).toISOString() }),
  execution({ startedAt: new Date(NOW.getTime() - 1 * DAY).toISOString() }),
];

describe('groupKey', () => {
  it('groups skill runs by their skill', () => {
    expect(groupKey(execution({ startedAt: NOW.toISOString(), mentionId: 'skill:recap' }))).toBe('skill:recap');
  });

  it('never groups workflow steps — a workflow already is the automation', () => {
    expect(groupKey(execution({ startedAt: NOW.toISOString(), mentionId: 'workflow:exec-1' }))).toBeNull();
  });

  it('falls back to the persona when there is no skill', () => {
    expect(groupKey(execution({ startedAt: NOW.toISOString(), mentionId: 'mention-1', personaId: 'p9' })))
      .toBe('agent:p9');
  });

  it('never groups local CLI sessions — "cli" is a sentinel, not an agent', () => {
    expect(groupKey(execution({ startedAt: NOW.toISOString(), mentionId: 'cli:s-1', personaId: 'cli' })))
      .toBeNull();
  });

  it('still groups a skill run that came from the CLI', () => {
    expect(groupKey(execution({ startedAt: NOW.toISOString(), mentionId: 'skill:recap', personaId: 'cli' })))
      .toBe('skill:recap');
  });

  it('returns null when there is nothing to group on', () => {
    expect(groupKey(execution({ startedAt: NOW.toISOString(), mentionId: 'm', personaId: '' }))).toBeNull();
  });
});

describe('mineAutomationCandidates', () => {
  it('surfaces work repeated often enough to be a habit', () => {
    const candidates = mineAutomationCandidates(series(6, DAY), { now: NOW });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: 'skill', targetId: 'daily-recap', occurrences: 6 });
  });

  it('ignores work repeated too few times to mean anything', () => {
    expect(mineAutomationCandidates(series(MIN_OCCURRENCES - 1, DAY), { now: NOW })).toEqual([]);
  });

  it('ignores failed runs — a repeatedly failing run is a bug, not a habit', () => {
    const failing = series(8, DAY).map((e) => ({ ...e, status: 'failed' as const }));
    expect(mineAutomationCandidates(failing, { now: NOW })).toEqual([]);
  });

  it('ignores occurrences outside the window', () => {
    const old = series(8, DAY).map((e) => ({
      ...e,
      startedAt: new Date(Date.parse(e.startedAt) - 200 * DAY).toISOString(),
    }));
    expect(mineAutomationCandidates(old, { now: NOW })).toEqual([]);
  });

  it('reports the mean gap and the observed span', () => {
    const candidates = mineAutomationCandidates(series(5, 2 * DAY), { now: NOW });
    expect(candidates[0]?.meanGapHours).toBeCloseTo(48, 1);
    expect(Date.parse(candidates[0]!.firstSeen)).toBeLessThan(Date.parse(candidates[0]!.lastSeen));
  });

  it('sums what the repeated work has cost', () => {
    const withCost = series(5, DAY).map((e) => ({ ...e, costUsd: 0.2 }));
    expect(mineAutomationCandidates(withCost, { now: NOW })[0]?.totalCostUsd).toBeCloseTo(1, 2);
  });

  it('orders by how often the work repeats', () => {
    const candidates = mineAutomationCandidates(
      [...series(5, DAY, { mentionId: 'skill:a' }), ...series(9, DAY, { mentionId: 'skill:b' })],
      { now: NOW },
    );
    expect(candidates.map((c) => c.targetId)).toEqual(['b', 'a']);
  });

  it('suggests a schedule when the cadence is regular', () => {
    const candidates = mineAutomationCandidates(series(7, DAY), { now: NOW });
    expect(candidates[0]?.suggestedCron).toBe('0 9 * * *');
    expect(candidates[0]?.rationale).toContain('regular enough to schedule');
  });

  it('drops a burst — the schedule is the only thing a suggestion adds', () => {
    expect(mineAutomationCandidates(BURST, { now: NOW })).toEqual([]);
  });

  it('surfaces the burst under includeIrregular, saying it cannot be scheduled', () => {
    const candidates = mineAutomationCandidates(BURST, { now: NOW, includeIrregular: true });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.suggestedCron).toBeUndefined();
    expect(candidates[0]?.rationale).toContain('too irregularly to schedule');
  });

  it('returns nothing for an empty log', () => {
    expect(mineAutomationCandidates([], { now: NOW })).toEqual([]);
  });
});

describe('resolveCandidateTargets', () => {
  type Stores = Parameters<typeof resolveCandidateTargets>[1];
  const stores = (skill: unknown, persona: unknown) => ({
    skillStore: { getById: async () => skill },
    personaStore: { getById: async () => persona },
  } as Stores);

  const skillRuns = mineAutomationCandidates(series(6, DAY, { mentionId: 'skill:s-1' }), { now: NOW });
  const agentRuns = mineAutomationCandidates(series(6, DAY, { mentionId: 'm-1', personaId: 'p-1' }), { now: NOW });

  it('targets a skill by its command name, and shows its display name', async () => {
    const resolved = await resolveCandidateTargets(
      skillRuns,
      stores({ commandName: 'rebase-remote-main', displayName: 'Rebase Remote Main' }, null),
    );
    expect(resolved[0]).toMatchObject({
      targetId: 's-1',
      target: 'rebase-remote-main',
      label: 'Rebase Remote Main',
    });
  });

  it('targets an agent by its persona name', async () => {
    const resolved = await resolveCandidateTargets(
      agentRuns,
      stores(null, { name: 'builder', displayName: 'The Builder' }),
    );
    expect(resolved[0]).toMatchObject({ kind: 'agent', target: 'builder', label: 'The Builder' });
  });

  it('falls back to the ref when there is no display name to show', async () => {
    const resolved = await resolveCandidateTargets(skillRuns, stores({ commandName: 'recap', displayName: '' }, null));
    expect(resolved[0]?.label).toBe('recap');
  });

  it('drops a candidate whose target is gone — a routine could not target it', async () => {
    expect(await resolveCandidateTargets(skillRuns, stores(null, null))).toEqual([]);
  });
});

describe('suggestCron', () => {
  it('declines with too few gaps to judge a cadence', () => {
    expect(suggestCron([DAY], DAY)).toBeUndefined();
  });

  it('declines when the gaps are too irregular', () => {
    expect(suggestCron([HOUR, 30 * DAY, HOUR], (HOUR + 30 * DAY + HOUR) / 3)).toBeUndefined();
  });

  it('snaps a regular cadence to a schedule a person recognises', () => {
    expect(suggestCron([HOUR, HOUR, HOUR], HOUR)).toBe('0 * * * *');
    expect(suggestCron([4 * HOUR, 4 * HOUR, 4 * HOUR], 4 * HOUR)).toBe('0 */4 * * *');
    expect(suggestCron([DAY, DAY, DAY], DAY)).toBe('0 9 * * *');
    expect(suggestCron([7 * DAY, 7 * DAY, 7 * DAY], 7 * DAY)).toBe('0 9 * * 1');
    expect(suggestCron([30 * DAY, 30 * DAY, 30 * DAY], 30 * DAY)).toBe('0 9 1 * *');
  });

  it('declines for a non-positive mean gap', () => {
    expect(suggestCron([0, 0, 0], 0)).toBeUndefined();
  });
});
