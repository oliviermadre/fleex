/**
 * The console popup of a station, a gate or a zone: its plate, its tabs, the doors out of a station and its places,
 * the colours of the floor's skin. What each tab holds of the old popup is pinned in `FactoryPopups.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FactoryMachinePopup } from './FactoryMachinePopup';
import { FactorySkinContext } from './FactoryConsolePopup';
import { useFactoryStore } from './factoryStore';
import { toast } from '../lib/toast';
import type { FactoryView } from './renderer';
import type { ArmSpec, FactorySnapshot, FactoryTicket, MachineSpec, TicketPhase } from './types';

vi.mock('../components/agents/ModelSelect', () => ({ ModelSelect: ({ value, ariaLabel }: { value: string; ariaLabel: string }) => <output aria-label={ariaLabel}>{value || 'own'}</output> }));
vi.mock('./factoryApi', () => ({ factoryApi: { machineRuns: vi.fn(async () => []) } }));

const onOk: ArmSpec = { id: 'a-ok', kind: 'arm', x: 6, y: 2, w: 1, h: 1, dir: 0, when: [{ field: 'outcome', op: 'is', values: ['ok'] }] };
const maquette: MachineSpec = { id: 'mq', kind: 'station', x: 1, y: 1, w: 5, h: 5, name: 'Maquette', exec: 'agent', ref: 'the-shaper', mode: 'edit', outcomes: ['ok', 'whatever'], cap: 6 };
const check: MachineSpec = { id: 'cs', kind: 'station', x: 10, y: 1, w: 5, h: 5, name: 'Check Spec', exec: 'script', outcomes: ['ok', 'ko'], cap: 2, script: { lines: [{ target: 'workspace', kind: 'command', value: 'pnpm lint' }], missing: 'ignore', onFail: 'all' } };
const review: MachineSpec = { id: 'rv', kind: 'station', x: 20, y: 1, w: 5, h: 5, name: 'Spec review', exec: 'human_gate', outcomes: ['approve', 'rework'], cap: 50 };
const solo: MachineSpec = { id: 'so', kind: 'station', x: 1, y: 8, w: 5, h: 5, name: 'Solo', exec: 'agent', ref: 'x', outcomes: ['done'], cap: 1 };
const others: MachineSpec[] = [{ ...solo, id: 'o1', outcomes: ['rework', 'ok'] } as MachineSpec, { ...solo, id: 'o2', outcomes: ['rework', 'needs-info'] } as MachineSpec];
const ticket = (id: string, machineId: string, phase: TicketPhase): FactoryTicket =>
  ({ ticketId: id, machineId, info: null, x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome: '', released: false, since: '2026-11-15T09:00:00.000Z', runId: null, note: '', handedAt: '' });

function seed(tickets: FactoryTicket[] = [], halted = false) {
  const layout = { version: 2, w: 40, h: 20, machines: [maquette, check, review, solo, onOk, ...others] };
  const snapshot: FactorySnapshot = { floor: { id: 'f', name: 'Floor', layout, settings: { maxRunsPerHour: 20, maxConcurrentRuns: 3, halted } }, tickets, arms: [], runsLastHour: 0, running: 0, serverTime: '2026-11-15T10:00:00.000Z' };
  useFactoryStore.setState({ enabled: true, snapshot, layout, stats: null, statsDays: 7, loadStats: vi.fn(async () => {}), power: vi.fn(async () => {}) });
}
const view = { use: () => {}, takersOf: (m: MachineSpec) => (m.id === 'mq' ? [onOk] : []), leadsTo: () => check, at: () => null } as unknown as FactoryView;
function open(machineId: string, skin?: { id: string; chrome: { vars: Record<string, string>; font: string | null; light: boolean } | null }) {
  const on = { onClose: vi.fn(), onPatch: vi.fn(), onRemove: vi.fn(), onOpenTicket: vi.fn(), onOpenMachine: vi.fn() };
  const popup = <FactoryMachinePopup machineId={machineId} view={view} {...on} />;
  render(skin ? <FactorySkinContext.Provider value={skin}>{popup}</FactorySkinContext.Provider> : popup);
  return on;
}
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));
const selected = () => screen.getByRole('tab', { selected: true }).textContent;

beforeEach(() => { vi.clearAllMocks(); window.localStorage.clear(); });
afterEach(() => cleanup());

describe('the doors out of a station', () => {
  it('shows where each outcome leaves, and that one no arm takes stays in the station', () => {
    seed();
    open('mq');
    tab('Routing');
    expect(selected()).toContain('!');                                                   // an outcome without an arm
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('arm · ok');
    expect(panel.textContent).toContain('Stays here');                                    // the engine keeps it, done: it is not set aside
    expect(panel.textContent).not.toContain('Set aside');
    expect(panel.textContent).toContain('stays here until answered');                     // the built-in question
  });

  it('adds an outcome, last, from those the floor already uses or by a typed name; question is reserved', () => {
    seed();
    const info = vi.spyOn(toast, 'info');
    const on = open('mq');
    tab('Routing');
    expect(screen.getAllByRole('button', { name: /^\+ / }).map((b) => b.textContent)).toEqual(['+ rework3 stations', '+ approve1 station', '+ done1 station', '+ ko1 station', '+ needs-info1 station']);
    fireEvent.click(screen.getByRole('button', { name: /^\+ rework/ }));
    expect(on.onPatch).toHaveBeenLastCalledWith('mq', { outcomes: ['ok', 'whatever', 'rework'] });
    expect(info).toHaveBeenCalledWith('rework added: until an arm takes it, its tickets stay here.');
    const field = screen.getByLabelText('Add an outcome');
    fireEvent.change(field, { target: { value: 'Needs Info' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(on.onPatch).toHaveBeenLastCalledWith('mq', { outcomes: ['ok', 'whatever', 'needs-info'] });
    on.onPatch.mockClear();
    fireEvent.change(field, { target: { value: 'question' } });
    expect(screen.getByRole('tabpanel').textContent).toContain('question is built in');
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.change(field, { target: { value: 'ok' } });
    fireEvent.keyDown(field, { key: 'Enter' });                                           // one it has: nothing
    expect(on.onPatch).not.toHaveBeenCalled();
  });

  it('makes another outcome the way forward, takes one off, never the last', () => {
    seed();
    const on = open('mq');
    tab('Routing');
    fireEvent.click(screen.getByRole('button', { name: 'Make whatever the way forward' }));
    expect(on.onPatch).toHaveBeenLastCalledWith('mq', { outcomes: ['whatever', 'ok'] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove ok' }));
    expect(on.onPatch).toHaveBeenLastCalledWith('mq', { outcomes: ['whatever'] });
    cleanup();
    open('so');
    tab('Routing');
    expect(screen.queryByRole('button', { name: /^Remove done/ })).toBeNull();
  });

  it("a script's doors are what its script gives: nothing to edit by hand", () => {
    seed();
    open('cs');
    tab('Routing');
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('Deduced from the script: not edited by hand.');
    expect(screen.queryByLabelText('Add an outcome')).toBeNull();
    expect(within(panel).queryByRole('button', { name: /way forward|^Remove/ })).toBeNull();
    expect(panel.textContent).not.toContain('question');
  });
});

describe('nothing a popup had is lost (RG1)', () => {
  it('a gate can still be resized from its popup, with the hint on why sizes are odd', () => {
    seed();
    open('rv');
    tab('Setup');
    const size = screen.getByLabelText('Size') as HTMLSelectElement;
    expect(size.id).toBe('f-size');
    expect(screen.getByRole('tabpanel').textContent).toContain('Odd, so that what comes in and goes out lines up on its middle');
  });

  it('a station lists every arm it leaves through, each one opening, even one no door names', () => {
    seed();
    const on = open('mq');
    tab('Routing');
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('Leaves through 1 arm');
    fireEvent.click(within(panel).getAllByTitle('Open this arm').at(-1)!);
    expect(on.onOpenMachine).toHaveBeenCalledWith('a-ok');
  });
});

describe('places', () => {
  it('one more or one fewer, saved at once, within the bounds a station always had', () => {
    seed();
    const on = open('mq');
    tab('Routing');
    expect((screen.getByRole('button', { name: 'One place more' }) as HTMLButtonElement).disabled).toBe(true);   // 6 at most for a station that runs
    fireEvent.click(screen.getByRole('button', { name: 'One place fewer' }));
    expect(on.onPatch).toHaveBeenLastCalledWith('mq', { cap: 5 });
    cleanup();
    open('rv');
    tab('Setup');
    expect((screen.getByRole('button', { name: 'One place more' }) as HTMLButtonElement).disabled).toBe(true);   // 50 for a gate
    expect(screen.getByRole('tabpanel').textContent).toContain('0 of 50 taken');        // past twelve, cells
  });
});

describe('the plate and the tabs', () => {
  it('a station opened during the emergency stop says it is halted, not running', () => {
    seed([], true);
    open('mq');
    expect(screen.getByTitle('The emergency stop is on: nothing runs on the floor.').textContent).toBe('Halted');
  });

  it('goes from tab to tab with the arrows, Home and End, and with 1 to 4; the last one chosen is where the next station opens', () => {
    seed();
    const first = open('mq');
    expect(selected()).toMatch(/^Setup/);
    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'ArrowRight' });
    expect(selected()).toMatch(/^Routing/);
    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'End' });
    expect(selected()).toMatch(/^Activity/);
    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'ArrowRight' });
    expect(selected()).toMatch(/^Inside/);                                                // round again
    fireEvent.keyDown(document.body, { key: '4' });
    expect(selected()).toMatch(/^Activity/);
    expect(first.onPatch).not.toHaveBeenCalled();
    cleanup();
    open('so');
    expect(selected()).toMatch(/^Activity/);
    cleanup();
    open('rv');                                                                            // a gate is not a station: its own memory
    expect(selected()).toMatch(/^Setup/);
  });

  it('opens on what waits on you, whatever was chosen before', () => {
    window.localStorage.setItem('factory.popup.tab.station', 'activity');
    seed([ticket('t1', 'mq', 'review')]);
    open('mq');
    expect(selected()).toMatch(/^Inside1/);
    expect(screen.getByRole('region', { name: 'Machine' }).textContent).toContain('1 needs you');
  });
});

describe("the floor's skin", () => {
  it("paints the popup in the skin's colours, its font kept for what is display", () => {
    seed();
    open('mq', { id: 'neon', chrome: { vars: { '--theme-bg-surface': '#0b0820' }, font: '"Orbitron", sans-serif', light: false } });
    const backdrop = screen.getByRole('region', { name: 'Machine' }).closest('[data-overlay-top]') as HTMLElement;
    expect(backdrop.style.getPropertyValue('--theme-bg-surface')).toBe('#0b0820');
    expect(backdrop.style.getPropertyValue('--fx-font')).toBe('"Orbitron", sans-serif');
    expect(backdrop.style.fontFamily).toBe('');                                            // fields keep Fleex's font
    expect(screen.getByRole('region', { name: 'Machine' }).getAttribute('data-skin')).toBe('neon');
  });
});

describe('the instructions editor', () => {
  it('opens over the station; Escape keeps what was typed and closes the editor only', () => {
    seed();
    const on = open('mq');
    fireEvent.click(screen.getByRole('button', { name: 'Edit in a large window' }));
    const editor = screen.getByLabelText('Instructions for this station');
    fireEvent.change(editor, { target: { value: 'Draw it.' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(on.onPatch).toHaveBeenCalledWith('mq', { prompt: 'Draw it.' });
    expect(screen.queryByLabelText('Instructions for this station')).toBeNull();
    expect(on.onClose).not.toHaveBeenCalled();
  });
});
