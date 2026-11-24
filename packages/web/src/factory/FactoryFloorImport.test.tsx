import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { FloorImportChoice, FloorImportReport } from './FactoryFloorImport';
import { FactoryNeeds } from './FactoryNeeds';

afterEach(cleanup);

describe('importing a floor', () => {
  it('asks where it goes: in place of this floor, or in hand', () => {
    const on = { onReplace: vi.fn(), onHand: vi.fn(), onClose: vi.fn() };
    render(<FloorImportChoice name="floor.json" incoming={12} here={84} {...on} />);
    expect(screen.getByText(/Replace the 84 machines of this floor/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Place it in hand' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace the floor' }));
    expect(on.onHand).toHaveBeenCalled(); expect(on.onReplace).toHaveBeenCalled();
  });

  it('reports what was taken off, machine by machine, with a way to each', () => {
    const onGo = vi.fn();
    render(<FloorImportReport total={9} unset={1} onGo={onGo} onClose={vi.fn()} dropped={[
      { machineId: 's', name: 'Triage', what: 'persona "toto"' }, { machineId: 's', name: 'Triage', what: 'model "x": its persona\'s own is used' },
      { machineId: 'a', name: 'An arm', what: 'board "Shop"' }, { machineId: 'a', name: 'An arm', what: '…', nothing: true },
    ]} />);
    expect(screen.getByText('Floor imported: 9 machines')).toBeTruthy();
    expect(screen.getByText(/1 station needs setting up/)).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: 'Taken off on import' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Triage: persona "toto", model "x"');
    expect(rows[1]!.textContent).toContain('so it takes nothing');
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Go to it' }));
    expect(onGo).toHaveBeenCalledWith('a');
  });

  it('lists a station that is not set up with what needs you', () => {
    const pick = vi.fn();
    render(<FactoryNeeds needs={[]} unset={[{ id: 's', name: 'Triage', gap: 'no persona' }]} selected={null} onPick={vi.fn()} onOpen={vi.fn()} onPickMachine={pick} />);
    expect(screen.getByText(/Needs you · 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Triage/ }));
    expect(pick).toHaveBeenCalledWith('s');
    expect(screen.getByText('not set up')).toBeTruthy();
  });
});
