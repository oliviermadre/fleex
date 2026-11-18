import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FactoryAvatar } from './FactoryAvatar';
import type { MachineSpec } from './types';

const info = { id: 't5', displayId: 5, title: 'A ticket', type: 'fix', priority: 'medium', status: 'doing' as const, tags: [], boardId: 'b', complexity: null, favorite: true, blocked: false };
const machines: MachineSpec[] = [
  { id: 'a', kind: 'station', x: 0, y: 0, w: 5, h: 4, name: 'Build', exec: 'agent', ref: 'builder', outcomes: ['ok'], cap: 2 },
  { id: 'g', kind: 'station', x: 0, y: 0, w: 4, h: 4, name: 'Check', exec: 'human_gate', outcomes: ['approve', 'reject'], cap: 8 },
  { id: 'z', kind: 'zone', x: 0, y: 0, w: 3, h: 3, name: 'Todo', status: 'todo', release: 'auto' },
  { id: 'b', kind: 'belt', x: 0, y: 0, w: 1, h: 1, dir: 0 },
  { id: 'r', kind: 'arm', x: 0, y: 0, w: 1, h: 1, dir: 0 },
  { id: 'e', kind: 'exit', x: 0, y: 0, w: 3, h: 3, name: 'Exit' },
];

describe('<FactoryAvatar/>', () => {
  it('is the factory with nothing selected, and the work site in build mode', () => {
    const { rerender } = render(<FactoryAvatar of={{ kind: 'floor' }} />);
    expect(screen.getByRole('img', { name: 'Factory' })).toBeTruthy();
    rerender(<FactoryAvatar of={{ kind: 'build' }} />);
    expect(screen.getByRole('img', { name: 'Build' })).toBeTruthy();
  });

  it('is the ticket itself for a ticket: its own object, named by its number and its type', () => {
    render(<FactoryAvatar of={{ kind: 'ticket', info }} />);
    const av = screen.getByRole('img', { name: '#5 Fix' });
    expect(av.querySelector('canvas')).toBeTruthy();                                // drawn by the code that draws it on the floor
  });

  it('has a portrait for each kind of machine, named by what it is', () => {
    const names = machines.map((m) => { const { unmount } = render(<FactoryAvatar of={{ kind: 'machine', machine: m }} />); const n = screen.getAllByRole('img').map((e) => e.getAttribute('aria-label')).find((l) => l && !l.endsWith('ticket')); unmount(); return n; });
    expect(names).toEqual(['Agent station', 'Gate', 'Zone', 'Belt', 'Arm', 'Exit']);
  });

  it('is a stack with a count for several things', () => {
    render(<FactoryAvatar of={{ kind: 'many', count: 7, of: 'tickets' }} />);
    expect(screen.getByRole('img', { name: 'Tickets: 7' }).textContent).toContain('7');
  });
});
