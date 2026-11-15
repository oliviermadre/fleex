/**
 * A Factory run creates no mention and no workflow step run, so the task view's
 * usual "waiting for your reply" / gate cards never fire for it. The banner is
 * the only place outside the floor that says the ticket waits for a human, and
 * it must carry the action that unblocks it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FactoryBanner } from './FactoryBanner';
import { useFactoryStore } from './factoryStore';
import type { FactorySnapshot, FactoryTicket, MachineSpec, TicketPhase } from './types';

const station: MachineSpec = { id: 'triage', kind: 'station', x: 1, y: 1, w: 3, h: 3, name: 'Triage', exec: 'agent', outcomes: ['bug', 'feature'], cap: 8 };
const gate: MachineSpec = { id: 'qa', kind: 'station', x: 6, y: 1, w: 3, h: 3, name: 'QA', exec: 'human_gate', outcomes: ['approve', 'reject'], cap: 8 };
const zone: MachineSpec = { id: 'awaiting', kind: 'zone', x: 1, y: 6, w: 2, h: 2, name: 'Awaiting answer', release: 'manual' };

function ticket(machineId: string, phase: TicketPhase, over: Partial<FactoryTicket> = {}): FactoryTicket {
  return { ticketId: 't1', machineId, info: null, x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome: '', released: false, since: '', runId: null, note: '', ...over };
}
function seed(t: FactoryTicket): { retry: ReturnType<typeof vi.fn>; resolve: ReturnType<typeof vi.fn> } {
  const snapshot: FactorySnapshot = {
    floor: { id: 'f', name: 'Floor', layout: { w: 20, h: 10, machines: [station, gate, zone] }, settings: { maxRunsPerHour: 20, maxConcurrentRuns: 3 } },
    tickets: [t], arms: [], runsLastHour: 0, running: 0, serverTime: '',
  };
  const retry = vi.fn(async () => {}), resolve = vi.fn(async () => {});
  useFactoryStore.setState({ enabled: true, managed: new Set(['t1']), snapshot, loadManaged: async () => {}, refresh: async () => {}, retry, resolve });
  return { retry, resolve };
}

describe('<FactoryBanner/>', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('a question asked in a station names the station, says replying alone restarts nothing, and offers Run again', () => {
    const { retry } = seed(ticket('triage', 'question', { outcome: 'question' }));
    render(<FactoryBanner ticketId="t1" />);
    expect(screen.getByRole('alert').textContent).toContain('Triage asked you a question');
    expect(screen.getByRole('alert').textContent).toContain('replying alone restarts nothing');
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    expect(retry).toHaveBeenCalledWith('t1');
  });

  it('a question routed out of its station (outcome "question") still asks for an answer, without a Run again it could not honour', () => {
    seed(ticket('awaiting', 'zone', { outcome: 'question' }));
    render(<FactoryBanner ticketId="t1" />);
    expect(screen.getByRole('alert').textContent).toContain('An agent asked you a question');
    expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
  });

  it('a gate offers one button per outcome', () => {
    const { resolve } = seed(ticket('qa', 'review'));
    render(<FactoryBanner ticketId="t1" />);
    expect(screen.getByRole('alert').textContent).toContain('QA is waiting for your decision');
    fireEvent.click(screen.getByRole('button', { name: 'reject' }));
    expect(resolve).toHaveBeenCalledWith('t1', 'reject');
  });

  it('a failed run shows its error', () => {
    seed(ticket('triage', 'failed', { note: 'boom' }));
    render(<FactoryBanner ticketId="t1" />);
    expect(screen.getByRole('alert').textContent).toContain('the run failed');
    expect(screen.getByRole('alert').textContent).toContain('boom');
  });

  it('a ticket moving along normally keeps the quiet green banner', () => {
    seed(ticket('triage', 'running'));
    render(<FactoryBanner ticketId="t1" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Managed by the Factory');
  });
});
