import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import type { AgentExecution } from '@fleex/shared';
import { RunCard } from './RunCard';
import { executionStopLabel, isUserHeld, threadStopLabel } from './stopLabel';

function execution(over: Partial<AgentExecution> = {}): AgentExecution {
  return {
    id: 'e1', personaId: 'p1', ticketId: 't1', mentionId: 'm1', eventCount: 3, status: 'interrupted',
    startedAt: '2026-09-21T10:00:00.000Z', completedAt: '2026-09-21T10:01:00.000Z', lastEventAt: null, model: 'Builder',
    ...over,
  };
}

afterEach(cleanup);

// Lot 2: wherever a run shows, a wanted stop names its author, neutrally.
describe('RunCard — a stopped run', () => {
  it.each([
    ['user', 'Arrêté par toi'],
    ['assistant', "Arrêté par l'assistant"],
  ] as const)('stopped by the %s shows « %s », muted — not the warning tint of an interruption, not red', (stoppedBy, label) => {
    render(<RunCard execution={execution({ stoppedBy })} onOpen={() => {}} />);
    const state = screen.getByText(label).parentElement!;
    expect(state.className).toContain('theme-text-muted');
    expect(state.className).not.toMatch(/red|yellow/);
    expect(screen.queryByText('interrupted')).toBeNull();
    expect(screen.queryByText('🛑')).toBeNull();
  });

  it('a timeout or a server restart (system) is not a decision: it keeps the interrupted state', () => {
    render(<RunCard execution={execution({ stoppedBy: 'system', stopReason: 'timeout' })} onOpen={() => {}} />);
    expect(screen.getByText('interrupted')).toBeTruthy();
    expect(screen.queryByText(/Arrêté par/)).toBeNull();
  });

  it('a row from before the author was recorded reads the 048 flag: stopped by the user', () => {
    render(<RunCard execution={execution({ manuallyTerminatedByUser: true })} onOpen={() => {}} />);
    expect(screen.getByText('Arrêté par toi')).toBeTruthy();
  });

  it('a run that completed, failed or still runs carries no stop label', () => {
    expect(executionStopLabel(execution({ status: 'completed' }))).toBeNull();
    expect(executionStopLabel(execution({ status: 'failed' }))).toBeNull();
    expect(executionStopLabel(execution({ status: 'running', stoppedBy: 'user' }))).toBeNull();
    expect(executionStopLabel(execution({ autoTerminatedAtConclusion: true }))).toBeNull();
  });
});

describe('thread stop label (delegation card, Threads panel)', () => {
  const at = '2026-09-21T10:05:00.000Z';
  it('names the author only while the thread is parked by that stop', () => {
    const lastStop = { by: 'user' as const, at, reason: null, mentionId: 'm1' };
    expect(threadStopLabel({ status: 'idle', lastStop })).toBe('Arrêté par toi');
    expect(threadStopLabel({ status: 'idle', lastStop: { ...lastStop, by: 'assistant' } })).toBe("Arrêté par l'assistant");
    expect(threadStopLabel({ status: 'idle', lastStop: null })).toBeNull();
    expect(threadStopLabel({ status: 'concluded', lastStop })).toBeNull();
    expect(threadStopLabel({ status: 'running', lastStop })).toBeNull();
  });
  it('the hold shows « Relancer » until the thread is concluded or the hold lifted', () => {
    expect(isUserHeld({ status: 'idle', userHoldAt: at })).toBe(true);
    expect(isUserHeld({ status: 'idle', userHoldAt: null })).toBe(false);
    expect(isUserHeld({ status: 'concluded', userHoldAt: at })).toBe(false);
  });
});
