/**
 * What the Factory opens over its floor instead of a side panel: a machine's sheet (settings, what it holds, what it
 * did) and the floor's own (figures, where tickets stand, safety limits).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { FactoryMachineSheet, machineKind } from './FactoryMachineSheet';
import { FactoryFloorSheet } from './FactoryFloorSheet';
import { useFactoryStore } from './factoryStore';
import { hasSheet } from './types';
import type { FactoryView } from './renderer';
import type { FactorySnapshot, FactoryStats, FactoryTicket, MachineSpec, MachineStats, TicketPhase } from './types';

vi.mock('../components/agents/ModelSelect', () => ({ ModelSelect: ({ value, ariaLabel }: { value: string; ariaLabel: string }) => <output aria-label={ariaLabel}>{value || 'own'}</output> }));
vi.mock('./factoryApi', () => ({ factoryApi: { machineRuns: vi.fn(async () => [{ id: 'r1', ticketId: 't1', machineId: 'dev', machineName: 'Dev', executor: 'agent', status: 'failed', outcome: null, executionId: null, error: 'boom', startedAt: '2026-11-15T09:00:00.000Z', finishedAt: '2026-11-15T09:05:00.000Z' }]) } }));

const dev: MachineSpec = { id: 'dev', kind: 'station', x: 1, y: 1, w: 5, h: 4, name: 'Dev', exec: 'agent', ref: 'builder', mode: 'edit', model: 'some-model', outcomes: ['done', 'blocked'], cap: 2 };
const gate: MachineSpec = { id: 'qa', kind: 'station', x: 8, y: 1, w: 5, h: 4, name: 'Check spec', exec: 'human_gate', outcomes: ['approve', 'reject'], cap: 8 };
const zone: MachineSpec = { id: 'parked', kind: 'zone', x: 1, y: 7, w: 2, h: 2, name: 'Parked', release: 'manual' };
const arm: MachineSpec = { id: 'a1', kind: 'arm', x: 6, y: 2, w: 1, h: 1, dir: 0, when: [] };
const belt: MachineSpec = { id: 'b', kind: 'belt', x: 7, y: 2, w: 1, h: 1, dir: 0 };
const machines = [dev, gate, zone, arm, belt];

const ticket = (id: string, machineId: string, phase: TicketPhase, over: Partial<FactoryTicket> = {}): FactoryTicket =>
  ({ ticketId: id, machineId, info: { id, displayId: 7, title: `Ticket ${id}`, type: 'build', priority: 'medium', status: 'doing', tags: [], boardId: 'b1', complexity: null, favorite: false, blocked: false }, x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome: '', released: false, since: '2026-11-15T09:00:00.000Z', runId: null, note: '', handedAt: '', ...over });
const figures = (machineId: string, name: string, over: Partial<MachineStats> = {}): MachineStats =>
  ({ machineId, name, executor: 'agent', onFloor: true, runs: 14, completed: 11, failed: 2, questions: 1, avgRunMs: 600000, avgHumanMs: null, humanWaits: 0, humanMs: 0, costUsd: 18.4, outcomes: { done: 11 }, ...over });
const stats: FactoryStats = { since: '', until: '', days: 7, machines: [figures('dev', 'Dev'), figures('old', 'Old reviewer', { onFloor: false, costUsd: 2 })], totals: { runs: 17, failed: 2, questions: 1, costUsd: 20.4, shipped: 9, avgLeadMs: 7200000, humanMs: 0 } };

function seed(tickets: FactoryTicket[], list: MachineSpec[] = machines) {
  const layout = { version: 2, w: 30, h: 12, machines: list };
  const snapshot: FactorySnapshot = { floor: { id: 'f', name: 'Floor', layout, settings: { maxRunsPerHour: 20, maxConcurrentRuns: 3 } }, tickets, arms: [], runsLastHour: 0, running: 0, serverTime: '2026-11-15T10:00:00.000Z' };
  const acts = { power: vi.fn(async () => {}), setAside: vi.fn(async () => {}), putBack: vi.fn(async () => {}), resolve: vi.fn(async () => {}), release: vi.fn(async () => {}), setSettings: vi.fn(async () => {}), loadStats: vi.fn(async () => {}) };
  useFactoryStore.setState({ enabled: true, snapshot, layout, stats, statsDays: 7, ...acts });
  return acts;
}
/** What the sheet asks the floor's view: who takes from a machine, and what stands where. */
const view = { use: () => {}, takersOf: (m: MachineSpec) => (m.id === 'dev' ? [arm] : []), leadsTo: () => gate, at: () => belt } as unknown as FactoryView;
const open = (machineId: string) => {
  const on = { onClose: vi.fn(), onPatch: vi.fn(), onRemove: vi.fn(), onOpenTicket: vi.fn(), onOpenMachine: vi.fn() };
  render(<FactoryMachineSheet machineId={machineId} view={view} {...on} />);
  return on;
};

afterEach(() => { cleanup(); });
beforeEach(() => { vi.clearAllMocks(); });

describe('which machines open in a sheet', () => {
  it('everything that has something to set or to show, so not a belt nor a bridge', () => {
    expect(machines.filter(hasSheet).map((m) => m.id)).toEqual(['dev', 'qa', 'parked', 'a1']);
    expect([dev, gate, zone, arm].map(machineKind)).toEqual(['Agent station', 'Gate', 'Zone', 'Arm']);
  });
});

describe('<FactoryMachineSheet/>', () => {
  it('shows a station whole: its settings, the tickets it holds with what each needs, and what it did', async () => {
    const acts = seed([ticket('t1', 'dev', 'running'), ticket('t2', 'dev', 'failed', { note: 'boom' })]);
    const on = open('dev');
    const sheet = screen.getByRole('region', { name: 'Machine' });
    expect(sheet.textContent).toContain('Agent station');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Dev');
    expect((screen.getByLabelText('Persona') as HTMLSelectElement).value).toBe('builder');
    expect(screen.getByLabelText('Model this station runs on').textContent).toBe('some-model');
    expect(sheet.textContent).toContain('2 tickets inside of 2');
    expect(sheet.textContent).toContain('What it did');
    expect(await screen.findByText(/boom/, { selector: 'span' })).toBeTruthy();      // the latest runs, with why one failed
    fireEvent.click(screen.getByRole('button', { name: 'Set aside' }));
    expect(acts.setAside).toHaveBeenCalledWith('t1');
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    expect(acts.putBack).toHaveBeenCalledWith('t2');
    fireEvent.click(screen.getByText('Ticket t1'));
    expect(on.onOpenTicket).toHaveBeenCalledWith('t1');
  });

  it('saves a setting when its field is left, and stops or starts the station from its bar', () => {
    const acts = seed([]);
    const on = open('dev');
    const name = screen.getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Build' } });
    expect(on.onPatch).not.toHaveBeenCalled();
    fireEvent.blur(name);
    expect(on.onPatch).toHaveBeenCalledWith('dev', { name: 'Build' });
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'plan' } });
    expect(on.onPatch).toHaveBeenLastCalledWith('dev', { mode: 'plan' });
    expect(screen.getByRole('region', { name: 'Machine' }).textContent).toContain('Running');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(acts.power).toHaveBeenCalledWith('dev', false);
    cleanup();
    const again = seed([], [{ ...dev, off: true } as MachineSpec, gate, zone, arm, belt]);
    open('dev');
    expect(screen.getByRole('region', { name: 'Machine' }).textContent).toContain('Stopped');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(again.power).toHaveBeenCalledWith('dev', true);
  });

  it('leads from a station to the arm that takes from it, and removes a machine', () => {
    seed([]);
    const on = open('dev');
    fireEvent.click(screen.getByTitle('Open this arm'));
    expect(on.onOpenMachine).toHaveBeenCalledWith('a1');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(on.onRemove).toHaveBeenCalledWith('dev');
    expect(on.onClose).toHaveBeenCalled();
  });

  it('a gate has no switch and decides from its tickets; a zone releases; an arm has only its rules', () => {
    const acts = seed([ticket('t1', 'qa', 'review'), ticket('t2', 'parked', 'zone')]);
    open('qa');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.queryByLabelText('Persona')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'reject' }));
    expect(acts.resolve).toHaveBeenCalledWith('t1', 'reject');
    cleanup();
    open('parked');
    expect(screen.getByRole('region', { name: 'Machine' }).textContent).not.toContain('What it did');
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    expect(acts.release).toHaveBeenCalledWith('t2');
    cleanup();
    open('a1');
    const sheet = screen.getByRole('region', { name: 'Machine' });
    expect(sheet.textContent).not.toContain('tickets inside');
    expect(sheet.textContent).toContain('Takes a ticket from the tile behind it');
  });

  it('closes when its machine is no longer on the floor', () => {
    seed([]);
    const on = open('gone');
    expect(on.onClose).toHaveBeenCalled();
  });
});

describe('<FactoryFloorSheet/>', () => {
  it('shows what the floor did machine by machine, where tickets stand, and saves the safety limits', () => {
    const acts = seed([ticket('t1', 'qa', 'review')]);
    const onGoTo = vi.fn(), onClose = vi.fn();
    render(<FactoryFloorSheet onClose={onClose} onGoTo={onGoTo} />);
    const sheet = screen.getByRole('region', { name: 'Factory floor' });
    expect(sheet.textContent).toContain('Shipped');
    const rows = within(sheet).getAllByRole('row').map((r) => r.textContent);
    expect(rows[1]).toContain('Dev');
    expect(rows[2]).toContain('Old reviewer (removed)');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Dev' }));
    expect(onGoTo).toHaveBeenCalledWith('dev');
    expect(onClose).toHaveBeenCalled();
    expect(sheet.textContent).toContain('Check spec');                              // a ticket stands there, waiting for a decision
    const perHour = screen.getByLabelText('Runs started per hour');
    fireEvent.change(perHour, { target: { value: '40' } });
    fireEvent.blur(perHour);
    expect(acts.setSettings).toHaveBeenCalledWith({ maxRunsPerHour: 40 });
  });
});
