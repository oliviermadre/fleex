import { beforeEach, describe, expect, it } from 'vitest';
import { badgesOf, lampOf, normalizeOutcome, openingTab, outcomeSuggestions, rememberTab, routingGap, runBars } from './stationConsole';
import type { ArmSpec, FactoryRun, FactoryTicket, MachineSpec, StationSpec, TicketPhase } from './types';

const agent = (over: Partial<StationSpec> = {}): StationSpec => ({ id: 's', kind: 'station', x: 0, y: 0, w: 5, h: 5, name: 'Maquette', exec: 'agent', ref: 'the-shaper', outcomes: ['ok', 'no-artifact'], cap: 4, ...over });
const ticket = (phase: TicketPhase, over: Partial<FactoryTicket> = {}): FactoryTicket =>
  ({ ticketId: phase, machineId: 's', info: null, x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome: '', released: false, since: '', runId: null, note: '', handedAt: '', ...over });
const arm = (when: ArmSpec['when'] = []): ArmSpec => ({ id: `a${when.length}`, kind: 'arm', x: 0, y: 0, w: 1, h: 1, dir: 0, when });
const onOk = arm([{ field: 'outcome', op: 'is', values: ['ok'] }] as ArmSpec['when']);

beforeEach(() => window.localStorage.clear());

describe('the lamp', () => {
  it('only a station that runs has one; the emergency stop shows over everything, then a station with nothing chosen', () => {
    expect(lampOf(agent(), false)).toBe('running');
    expect(lampOf(agent({ off: true }), false)).toBe('stopped');
    expect(lampOf(agent({ ref: '', off: true }), false)).toBe('unset');                  // unset says more than stopped
    expect(lampOf(agent({ ref: '' }), true)).toBe('halted');                             // and halted more than anything: nothing runs
    expect(lampOf(agent({ exec: 'human_gate' }), false)).toBeNull();
    expect(lampOf({ id: 'z', kind: 'zone', x: 0, y: 0, w: 2, h: 2, release: 'manual' }, false)).toBeNull();
  });
});

describe('badges and the tab a popup opens on', () => {
  it('Inside counts what waits on a human, failed runs included; Routing flags an outcome no arm takes', () => {
    const tickets = [ticket('review'), ticket('question'), ticket('failed'), ticket('running')];
    expect(badgesOf(agent(), tickets, [onOk])).toEqual({ inside: '3', routing: '!' });   // no-artifact has no arm
    expect(badgesOf(agent(), [], [arm()])).toEqual({});                                   // an arm with no condition takes the rest
    expect(routingGap(agent(), [])).toBe(true);                                           // no arm at all
    expect(badgesOf(agent({ ref: '' }), [], [arm()])).toEqual({ setup: '!' });
    /* a gate has no Routing tab: no arm at all shows on its Setup */
    expect(badgesOf(agent({ exec: 'human_gate' }), [], [])).toEqual({ setup: '!' });
  });

  it('opens on Inside when a ticket waits on you, on Setup while unset, else on the last tab of its family', () => {
    expect(openingTab(agent(), [])).toBe('setup');
    rememberTab('station', 'activity');
    expect(openingTab(agent(), [])).toBe('activity');
    expect(openingTab(agent({ ref: '' }), [])).toBe('setup');
    expect(openingTab(agent(), [ticket('review')])).toBe('inside');
    /* a gate is a family of its own, and a zone has no Activity tab to go back to */
    expect(openingTab(agent({ exec: 'human_gate' }), [])).toBe('setup');
    rememberTab('zone', 'activity');
    expect(openingTab({ id: 'z', kind: 'zone', x: 0, y: 0, w: 2, h: 2, release: 'manual' } as MachineSpec, [])).toBe('setup');
  });
});

describe('outcome names', () => {
  it('are written lower case with dashes, whatever is typed', () => {
    expect(normalizeOutcome('  Needs Info ')).toBe('needs-info');
    expect(normalizeOutcome('re_work!')).toBe('re-work');
  });

  it('are suggested from the other stations of the floor: the most used first, never question nor one it has', () => {
    const others: MachineSpec[] = [
      agent(), agent({ id: 'b', outcomes: ['ok', 'rework', 'question'] }), agent({ id: 'c', outcomes: ['rework', 'ko'] }), agent({ id: 'd', outcomes: ['needs-info'] }),
    ];
    expect(outcomeSuggestions(agent(), others, '')).toEqual([{ name: 'rework', stations: 2 }, { name: 'ko', stations: 1 }, { name: 'needs-info', stations: 1 }]);
    expect(outcomeSuggestions(agent(), others, 'Needs').map((o) => o.name)).toEqual(['needs-info']);
  });
});

describe('the run histogram', () => {
  const run = (startedAt: string): FactoryRun => ({ id: startedAt, ticketId: 't', machineId: 's', machineName: 'S', executor: 'agent', status: 'completed', outcome: 'ok', executionId: null, error: null, startedAt, finishedAt: null });
  it('has a bar per hour over a day, per day over a week, and counts what falls in each', () => {
    const now = '2026-11-27T12:00:00.000Z';
    const day = runBars([run('2026-11-27T11:30:00.000Z'), run('2026-11-27T11:10:00.000Z'), run('2026-11-26T13:30:00.000Z')], 1, now);
    expect(day.bars).toHaveLength(24);
    expect(day.bars[23]).toBe(2);
    expect(day.bars[1]).toBe(1);
    expect(runBars([], 7, now).bars).toHaveLength(7);
  });
  it('says when the latest runs loaded do not reach back to the start of the period', () => {
    const now = '2026-11-27T12:00:00.000Z', runs = Array.from({ length: 60 }, (_, i) => run(new Date(Date.parse(now) - i * 3_600_000).toISOString()));
    expect(runBars(runs, 30, now).truncated).toBe(true);
    expect(runBars(runs.slice(0, 10), 30, now).truncated).toBe(false);
  });
});
