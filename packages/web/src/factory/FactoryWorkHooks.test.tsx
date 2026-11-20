/**
 * The Factory in the Work view: its group in a ticket's context (where the ticket is, set aside / put back) and what
 * the floor asks of someone at the foot of the thread. A Factory run creates no mention and no workflow step run, so
 * the thread's usual "waiting for you" cards never fire for it: the thread card is that signal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { FactoryContextGroup } from './FactoryContextGroup';
import { FactoryThreadCard } from './FactoryThreadCard';
import { FactoryHandover } from './FactoryHandover';
import { useFactoryStore } from './factoryStore';
import type { FactorySnapshot, FactoryTicket, MachineSpec, TicketPhase } from './types';

const station: MachineSpec = { id: 'dev', kind: 'station', x: 1, y: 1, w: 5, h: 4, name: 'Dev', exec: 'agent', outcomes: ['done', 'blocked'], cap: 2 };
const gate: MachineSpec = { id: 'qa', kind: 'station', x: 8, y: 1, w: 5, h: 4, name: 'Check spec', exec: 'human_gate', outcomes: ['approve', 'reject', 'help'], cap: 8 };
const zone: MachineSpec = { id: 'parked', kind: 'zone', x: 1, y: 7, w: 2, h: 2, name: 'Parked', release: 'manual' };
const belt: MachineSpec = { id: 'b', kind: 'belt', x: 7, y: 2, w: 1, h: 1, dir: 0 };

function ticket(machineId: string, phase: TicketPhase, over: Partial<FactoryTicket> = {}): FactoryTicket {
  return { ticketId: 't1', machineId, info: null, x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome: '', released: false, since: '', runId: null, note: '', handedAt: '', ...over };
}
function seed(t: FactoryTicket | null, managed = true) {
  const snapshot: FactorySnapshot = {
    floor: { id: 'f', name: 'Floor', layout: { w: 30, h: 12, machines: [station, gate, zone, belt] }, settings: { maxRunsPerHour: 20, maxConcurrentRuns: 3 } },
    tickets: t ? [t] : [], arms: [], runsLastHour: 0, running: 0, serverTime: '',
  };
  const acts = { setAside: vi.fn(async () => {}), putBack: vi.fn(async () => {}), resolve: vi.fn(async () => {}), move: vi.fn(async () => {}) };
  useFactoryStore.setState({ enabled: true, managed: new Set(managed ? ['t1'] : []), snapshot, loadManaged: async () => {}, refresh: async () => {}, ...acts });
  return acts;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('<FactoryContextGroup/>', () => {
  it('is not there for a ticket that is not on the floor, nor when the Factory is off', () => {
    seed(null, false);
    const { container, rerender } = render(<FactoryContextGroup ticketId="t1" />);
    expect(container.textContent).toBe('');
    seed(ticket('dev', 'running'));
    useFactoryStore.setState({ enabled: false });
    rerender(<FactoryContextGroup ticketId="t1" />);
    expect(container.textContent).toBe('');
  });

  it('says where the ticket is and offers to set aside one a station is working on', () => {
    const acts = seed(ticket('dev', 'running'));
    render(<FactoryContextGroup ticketId="t1" />);
    const group = screen.getByLabelText('Factory');
    expect(group.textContent).toContain('Dev');
    expect(group.textContent).toContain('Running');
    expect(group.textContent).toContain('Stops the run of Dev');
    expect(screen.queryByRole('button', { name: 'Run Dev again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set aside' }));
    expect(acts.setAside).toHaveBeenCalledWith('t1');
  });

  it('offers every way back to a ticket set aside: another run, each way out, another machine', async () => {
    const acts = seed(ticket('dev', 'aside'));
    render(<FactoryContextGroup ticketId="t1" />);
    expect(screen.queryByRole('button', { name: 'Set aside' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Run Dev again' }));
    expect(acts.putBack).toHaveBeenLastCalledWith('t1');
    await act(async () => {});                                  // the buttons are held while an action is on its way
    fireEvent.click(screen.getByRole('button', { name: 'Leave as blocked' }));
    expect(acts.putBack).toHaveBeenLastCalledWith('t1', 'blocked');
    await act(async () => {});
    const other = screen.getByLabelText('Send to another machine') as HTMLSelectElement;
    expect([...other.options].map((o) => o.textContent)).toEqual(['Send to another machine', 'Check spec', 'Parked']);
    fireEvent.change(other, { target: { value: 'parked' } });
    expect(acts.move).toHaveBeenCalledWith('t1', { machineId: 'parked' });
  });

  it('offers the same ways back after a failed run and after a question', () => {
    seed(ticket('dev', 'failed', { note: 'boom' }));
    const { rerender } = render(<FactoryContextGroup ticketId="t1" />);
    expect(screen.getByLabelText('Factory').textContent).toContain('boom');
    expect(screen.getByRole('button', { name: 'Run Dev again' })).toBeTruthy();
    seed(ticket('dev', 'question', { outcome: 'question' }));
    rerender(<FactoryContextGroup ticketId="t1" />);
    expect(screen.getByRole('button', { name: 'Leave as done' })).toBeTruthy();
  });

  it('offers nothing to do at a gate, on a belt or in a zone: only where the ticket is', () => {
    for (const t of [ticket('qa', 'review'), ticket('b', 'belt'), ticket('parked', 'zone')]) {
      seed(t);
      render(<FactoryContextGroup ticketId="t1" />);
      expect(screen.queryByRole('button', { name: 'Set aside' })).toBeNull();
      expect(screen.queryByRole('button', { name: /again/ })).toBeNull();
      expect(screen.queryByLabelText('Send to another machine')).toBeNull();
      cleanup();
    }
  });
});

describe('<FactoryHandover/>', () => {
  const hand = () => { const acts = { transfer: vi.fn(async () => {}), giveBack: vi.fn(async () => {}) }; useFactoryStore.setState(acts); return acts; };

  it('sends to the Factory a ticket plain Fleex drives: it lands in Inbound, no target given', () => {
    seed(null, false);
    const acts = hand();
    render(<FactoryHandover ticketId="t1" status="todo" />);
    expect(screen.queryByRole('button', { name: 'Take back from Factory' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send to Factory' }));
    expect(acts.transfer).toHaveBeenCalledWith('t1', {});
    expect(screen.getByRole('group', { name: 'Who drives this ticket' }).textContent).toContain('Inbound zone');
  });

  it('takes back a ticket the Factory drives, and says what happens to a run in progress', () => {
    seed(ticket('dev', 'running'));
    const acts = hand();
    render(<FactoryHandover ticketId="t1" status="doing" />);
    expect(screen.queryByRole('button', { name: 'Send to Factory' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Who drives this ticket' }).textContent).toContain('its result is ignored');
    fireEvent.click(screen.getByRole('button', { name: 'Take back from Factory' }));
    expect(acts.giveBack).toHaveBeenCalledWith('t1');
  });

  it('does not send a ticket that is done or cancelled, and is not there while the Factory is off', () => {
    seed(null, false);
    hand();
    const { container, rerender } = render(<FactoryHandover ticketId="t1" status="done" />);
    expect((screen.getByRole('button', { name: 'Send to Factory' }) as HTMLButtonElement).disabled).toBe(true);
    useFactoryStore.setState({ enabled: false });
    rerender(<FactoryHandover ticketId="t1" status="todo" />);
    expect(container.textContent).toBe('');
  });
});

describe('<FactoryThreadCard/>', () => {
  it('asks for a gate decision with one button per outcome, and sends a several-line markdown reason with it', () => {
    const acts = seed(ticket('qa', 'review'));
    render(<FactoryThreadCard ticketId="t1" />);
    expect(screen.getByRole('alert').textContent).toContain('Check spec waits for your decision');
    /* a long reason (say why you need help) does not fit one line: it is the thread's multi-line composer */
    const field = screen.getByPlaceholderText(/Reason \(optional\)/) as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    const reason = 'I need help:\n- the stack does not start\n\n```\nNo legacy PostgreSQL DSN\n```';
    fireEvent.change(field, { target: { value: reason } });
    /* Enter is a newline: typing the reason never picks an outcome, only a button does */
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(acts.resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'help' }));
    expect(acts.resolve).toHaveBeenCalledWith('t1', 'help', reason);
  });

  it('says a reply gives the ticket back to the station that asked, with no button to press', () => {
    seed(ticket('dev', 'question', { outcome: 'question' }));
    render(<FactoryThreadCard ticketId="t1" />);
    expect(screen.getByRole('alert').textContent).toContain('Dev asked you a question');
    expect(screen.getByRole('alert').textContent).toContain('Your reply gives the ticket back to it');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('still asks for an answer when the question left its station, without promising a restart', () => {
    seed(ticket('parked', 'zone', { outcome: 'question' }));
    render(<FactoryThreadCard ticketId="t1" />);
    expect(screen.getByRole('alert').textContent).toContain('An agent asked you a question');
    expect(screen.getByRole('alert').textContent).toContain('the next station');
  });

  it('shows why a run failed and runs the station again', () => {
    const acts = seed(ticket('dev', 'failed', { note: 'boom' }));
    render(<FactoryThreadCard ticketId="t1" />);
    expect(screen.getByRole('alert').textContent).toContain('Dev: the run failed');
    expect(screen.getByRole('alert').textContent).toContain('boom');
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    expect(acts.putBack).toHaveBeenCalledWith('t1');
  });

  it('only points to Context for a ticket someone set aside, and says nothing for one that moves along', () => {
    seed(ticket('dev', 'aside'));
    const { rerender, container } = render(<FactoryThreadCard ticketId="t1" />);
    expect(screen.getByRole('status').textContent).toContain('Set aside in Dev');
    expect(screen.queryByRole('button')).toBeNull();
    seed(ticket('dev', 'running'));
    rerender(<FactoryThreadCard ticketId="t1" />);
    expect(container.textContent).toBe('');
  });
});
