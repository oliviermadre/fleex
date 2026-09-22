import { describe, it, expect } from 'vitest';
import { AgentThreadEntity } from '../../src/domain/entities/agent-thread.entity.js';

function thread() {
  return AgentThreadEntity.create({
    id: 'th1', ticketId: 't1', personaId: 'p1', personaName: 'builder',
    assistantPersonaId: 'pa', brief: 'Fix the e2e', forwardedContext: ['ticket', 'pr'],
  });
}

describe('AgentThreadEntity', () => {
  it('starts running with no mention and zero exchanges', () => {
    const t = thread();
    expect(t.status).toBe('running');
    expect(t.currentMentionId).toBeNull();
    expect(t.exchanges).toBe(0);
    expect(t.toDTO().forwardedContext).toEqual(['ticket', 'pr']);
  });

  it('openTurn sets the current mention, counts an exchange and returns to running', () => {
    const t = thread();
    t.markWaiting();
    t.openTurn('m1');
    expect(t.currentMentionId).toBe('m1');
    expect(t.exchanges).toBe(1);
    expect(t.status).toBe('running');
  });

  it('waiting ↔ running transitions', () => {
    const t = thread();
    expect(t.markWaiting()).toBe(true);
    expect(t.status).toBe('waiting');
    expect(t.markRunning()).toBe(true);
    expect(t.status).toBe('running');
  });

  it('conclude is terminal and records the summary', () => {
    const t = thread();
    expect(t.conclude('Done, 540 tests green')).toBe(true);
    expect(t.status).toBe('concluded');
    expect(t.summary).toBe('Done, 540 tests green');
    expect(t.concludedAt).not.toBeNull();
    expect(t.isTerminal).toBe(true);
    expect(t.markWaiting()).toBe(false);
    expect(t.openTurn('m2')).toBe(false);
    expect(t.fail()).toBe(false);
  });

  it('fail is NOT terminal: it counts a failure and the thread can be relaunched', () => {
    const t = thread();
    expect(t.fail()).toBe(true);
    expect(t.status).toBe('failed');
    expect(t.failures).toBe(1);
    expect(t.isTerminal).toBe(false);
    expect(t.openTurn('m2')).toBe(true);
    expect(t.status).toBe('running');
    t.fail();
    expect(t.failures).toBe(2);
    t.clearFailures();
    expect(t.failures).toBe(0);
    expect(t.conclude('x')).toBe(true);
  });

  it('recordTurn counts exchanges without touching the mention', () => {
    const t = thread();
    t.recordTurn();
    t.recordTurn();
    expect(t.exchanges).toBe(2);
    expect(t.currentMentionId).toBeNull();
  });
});

describe('AgentThreadEntity — idle', () => {
  it('markIdle parks the thread until the assistant relaunches it', () => {
    const t = thread();
    t.openTurn('m1');
    expect(t.markIdle()).toBe(true);
    expect(t.status).toBe('idle');
    expect(t.isTerminal).toBe(false);
    expect(t.openTurn('m2')).toBe(true);
    expect(t.status).toBe('running');
  });
});
