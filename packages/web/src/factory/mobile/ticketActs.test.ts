import { describe, expect, it } from 'vitest';
import { actsFor, askOf, hasActs } from './ticketActs';
import { MACHINES, tk } from './fixture';

const m = (id: string) => MACHINES.find((x) => x.id === id)!;

describe('what the phone offers on a ticket, from where it stands', () => {
  it('a gate is decided by one of its outcomes, and nothing else', () => {
    const a = actsFor(tk(1, 'gate', 'review'), m('gate'));
    expect(a.decide).toEqual(['approve', 'reject', 'fix-first']);
    expect([a.again, a.release, a.aside, a.answer, a.leaveAs.length]).toEqual([false, false, false, false, 0]);
  });

  it('a ticket set aside, a failed run and a question are put back: another run, or out by an outcome', () => {
    for (const phase of ['aside', 'failed', 'question'] as const) {
      const a = actsFor(tk(1, 'build', phase), m('build'));
      expect(a.again).toBe(true);
      expect(a.leaveAs).toEqual(['done', 'blocked']);
      expect(a.aside).toBe(false);                       // it already is
      expect(a.answer).toBe(phase === 'question');
    }
  });

  it('a ticket a station is working on can be set aside; one held in a zone is released, once', () => {
    for (const phase of ['wait', 'running', 'out'] as const) expect(actsFor(tk(1, 'build', phase), m('build')).aside).toBe(true);
    expect(actsFor(tk(1, 'gate', 'review'), m('gate')).aside).toBe(false);       // a gate has nothing to set aside
    expect(actsFor(tk(1, 'inbound', 'zone'), m('inbound')).release).toBe(true);
    expect(actsFor(tk(1, 'inbound', 'zone', 1, { released: true }), m('inbound')).release).toBe(false);
  });

  it('an unanswered question that travels is still answered, and offers nothing of a station', () => {
    const a = actsFor(tk(1, 'belt', 'belt', 1, { outcome: 'question' }), m('belt'));
    expect(a.answer).toBe(true);
    expect(a.again).toBe(false);
  });

  it('offers nothing on a ticket that is on its way, or lying on the floor', () => {
    expect(hasActs(actsFor(tk(1, 'belt', 'belt'), m('belt')))).toBe(false);
    expect(hasActs(actsFor(tk(1, null, 'loose'), null))).toBe(false);
    expect(hasActs(actsFor(tk(1, 'build', 'running'), m('build')))).toBe(true);
  });
});

describe('what the floor asks of someone, in a line', () => {
  it('names the machine and what it waits for', () => {
    expect(askOf(tk(1, 'gate', 'review'), m('gate'))).toEqual({ kind: 'decision', line: 'PR Review waits for your decision' });
    expect(askOf(tk(1, 'tests', 'failed'), m('tests'))?.line).toBe('Tests: the run failed');
    expect(askOf(tk(1, 'build', 'question'), m('build'))?.line).toBe('Build asked you a question');
    expect(askOf(tk(1, 'build', 'aside'), m('build'))?.kind).toBe('aside');
    expect(askOf(tk(1, null, 'loose'), null)?.kind).toBe('floor');
  });

  it('asks for the tickets of a zone of work done by hand, and of no other zone', () => {
    expect(askOf(tk(1, 'qa', 'zone'), m('qa'))).toEqual({ kind: 'zone', line: 'Manual QA: release it when your part is done' });
    expect(askOf(tk(1, 'inbound', 'zone'), m('inbound'))).toBeNull();
    expect(askOf(tk(1, 'build', 'running'), m('build'))).toBeNull();
  });
});
