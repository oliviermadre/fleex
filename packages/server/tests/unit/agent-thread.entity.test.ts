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

describe('AgentThreadEntity — target', () => {
  const base = { id: 'th', ticketId: 't', personaId: 'x', personaName: 'lint', assistantPersonaId: 'pa', brief: 'b', forwardedContext: [] };
  it('is a persona thread unless told otherwise', () => {
    const t = AgentThreadEntity.create(base);
    expect(t.targetType).toBe('agent');
    expect(t.toDTO().targetType).toBe('agent');
  });
  // The mention tag is how a turn reaches the target through the existing mention pipeline.
  it('addresses its target with the mention prefix of its type', () => {
    for (const targetType of ['agent', 'skill', 'panel', 'workflow'] as const) {
      expect(AgentThreadEntity.create({ ...base, targetType }).mentionTag).toBe(`@${targetType}:lint`);
    }
  });

  // A wanted stop is a decision, not a failure (lot 2).
  describe('a run stopped on purpose', () => {
    it('by the user: idle, held, failures untouched, and the stopped mention is remembered', () => {
      const t = thread();
      t.openTurn('m1');
      t.fail(); t.markRunning();
      expect(t.recordStop('user', 'mauvaise piste')).toBe(true);
      expect(t.status).toBe('idle');
      expect(t.failures).toBe(1);
      expect(t.userHoldAt).toBeInstanceOf(Date);
      expect(t.lastStop).toMatchObject({ by: 'user', reason: 'mauvaise piste', mentionId: 'm1' });
      expect(t.isStoppedMention('m1')).toBe(true);
      expect(t.isStoppedMention('m2')).toBe(false);
      expect(t.isStoppedMention(null)).toBe(false);
      expect(t.toDTO()).toMatchObject({ userHoldAt: t.userHoldAt!.toISOString(), lastStop: { by: 'user' } });
    });

    it('by the assistant: idle, no hold', () => {
      const t = thread();
      t.openTurn('m1');
      t.recordStop('assistant', 'consigne changée');
      expect(t.status).toBe('idle');
      expect(t.userHoldAt).toBeNull();
      expect(t.lastStop?.by).toBe('assistant');
    });

    it('a new run clears the stop and the hold; lifting the hold alone keeps the record of the stop', () => {
      const t = thread();
      t.openTurn('m1');
      t.recordStop('user');
      expect(t.liftUserHold()).toBe(true);
      expect(t.liftUserHold()).toBe(false);
      expect(t.userHoldAt).toBeNull();
      expect(t.isStoppedMention('m1')).toBe(true);
      t.recordStop('user');
      t.openTurn('m2');
      expect(t.userHoldAt).toBeNull();
      expect(t.lastStop).toBeNull();
      expect(t.isStoppedMention('m1')).toBe(false);
    });

    it('a concluded thread cannot be stopped, and remembers who concluded it', () => {
      const t = thread();
      t.conclude('fini', 'user');
      expect(t.concludedBy).toBe('user');
      expect(t.recordStop('user')).toBe(false);
      expect(t.status).toBe('concluded');
      const mine = thread();
      mine.conclude('fini');
      expect(mine.concludedBy).toBe('assistant');
    });
  });
});
