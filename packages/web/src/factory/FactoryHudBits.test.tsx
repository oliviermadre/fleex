import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { clockText, Groups, Units, UNITS_PAGE, type Unit } from './FactoryHudBits';
import type { FactoryLayout, FactoryTicket, Selection } from './types';

const t = (n: number, type = 'build'): FactoryTicket => ({ ticketId: `t${n}`, machineId: 'dev', info: { id: `t${n}`, displayId: n, title: `Ticket ${n}`, type, priority: 'medium', status: 'doing', tags: [], boardId: 'b', complexity: null, favorite: false, blocked: false }, x: 0, y: 0, phase: 'wait', p: 0, fx: 1, fy: 0, outcome: '', released: false, since: '', runId: null, note: '', handedAt: '' });
const layout: FactoryLayout = { w: 20, h: 10, machines: [
  { id: 'dev', kind: 'station', x: 1, y: 1, w: 5, h: 4, name: 'Build', exec: 'agent', ref: 'builder', outcomes: ['ok'], cap: 2 },
  { id: 'b1', kind: 'belt', x: 7, y: 2, w: 1, h: 1, dir: 0 },
] };
const unit = (i: number): Unit => ({ id: `u${i}`, face: <i />, name: `Unit ${i}`, sub: 'somewhere' });

describe('the clock', () => {
  it('reads to the second, on two digits each', () => {
    expect(clockText(new Date(2026, 0, 5, 7, 4, 9))).toBe('07:04:09');
    expect(clockText(new Date(2026, 0, 5, 23, 59, 0))).toBe('23:59:00');
  });
});

describe('<Groups/>', () => {
  const groups = (over: Record<number, Selection>): Selection[] => Array.from({ length: 10 }, (_, i) => over[i] ?? null);

  it('has ten places that never move, and shows only those that hold something', () => {
    render(<Groups groups={groups({ 1: { ticket: 't5' }, 3: { tickets: ['t5', 't12', 't18'] } })} selection={null} tickets={[t(5), t(12), t(18)]} layout={layout} onGroup={vi.fn()} />);
    const row = screen.getByRole('group', { name: 'Saved selections' });
    expect(row.children).toHaveLength(10);
    const shown = within(row).getAllByRole('button');
    expect(shown.map((b) => [...row.children].indexOf(b))).toEqual([1, 3]);         // each at its own place, not packed to the left
  });

  it('says a single ticket by its number, several things by how many, a single machine by its icon alone', () => {
    render(<Groups groups={groups({ 0: { machine: 'dev' }, 1: { ticket: 't5' }, 2: { tickets: ['t5', 't12'] }, 3: { machines: ['dev', 'b1'] } })} selection={null} tickets={[t(5), t(12)]} layout={layout} onGroup={vi.fn()} />);
    const text = (name: string) => screen.getByRole('button', { name }).textContent;
    expect(text('Group 1: Build')).toBe('1');                                      // its key, and an icon
    expect(text('Group 2: #5 Ticket 5')).toBe('25');                               // its key, then the ticket's number
    expect(text('Group 3: 2 tickets')).toBe('3×2');
    expect(text('Group 4: 2 machines')).toBe('4×2');
  });

  it('recalls on a click and saves over it on Shift and a click', () => {
    const onGroup = vi.fn();
    render(<Groups groups={groups({ 4: { ticket: 't5' } })} selection={null} tickets={[t(5)]} layout={layout} onGroup={onGroup} />);
    const chip = screen.getByRole('button', { name: 'Group 5: #5 Ticket 5' });
    fireEvent.click(chip); expect(onGroup).toHaveBeenLastCalledWith(4, false);
    fireEvent.click(chip, { shiftKey: true }); expect(onGroup).toHaveBeenLastCalledWith(4, true);
  });

  it('keeps its place when what it held has left the floor, and says so', () => {
    render(<Groups groups={groups({ 0: { ticket: 'gone' } })} selection={null} tickets={[]} layout={layout} onGroup={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Group 1:/ }).textContent).toBe('1–');
  });
});

describe('<Units/>', () => {
  it('shows one icon per selected thing; a click keeps only it, Shift and a click take it out', () => {
    const onPick = vi.fn();
    render(<Units units={[unit(1), unit(2), unit(3)]} onPick={onPick} />);
    const all = within(screen.getByRole('group', { name: 'Selected' })).getAllByRole('button');
    expect(all.map((b) => b.getAttribute('aria-label'))).toEqual(['Unit 1', 'Unit 2', 'Unit 3']);
    fireEvent.click(all[1]!); expect(onPick).toHaveBeenLastCalledWith('u2', false);
    fireEvent.click(all[2]!, { shiftKey: true }); expect(onPick).toHaveBeenLastCalledWith('u3', true);
    expect(screen.queryByRole('group', { name: 'Pages' })).toBeNull();             // no pages while everything fits
  });

  it('shows twenty-four at once, and the rest as pages', () => {
    render(<Units units={Array.from({ length: 30 }, (_, i) => unit(i + 1))} onPick={vi.fn()} />);
    const shown = () => within(screen.getByRole('group', { name: 'Selected' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(UNITS_PAGE).toBe(24);
    expect(shown()).toHaveLength(24);
    expect(within(screen.getByRole('group', { name: 'Pages' })).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Page 2 of 2' }));
    expect(shown()).toEqual(['Unit 25', 'Unit 26', 'Unit 27', 'Unit 28', 'Unit 29', 'Unit 30']);
  });
});
