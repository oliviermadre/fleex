import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { TimelineFilterMenu } from './TimelineFilterMenu';
import type { TimelineFilters } from './layoutTimeline';
import type { TimelineFilterKey } from '../../../stores/workStore';

afterEach(cleanup);

const ALL: TimelineFilters = { status: true, cli: true, pr: true, deliverables: true, comments: true };

/** Wires the menu to real state, like the store does, to observe what a user sees. */
function Harness({ initial, spy }: { initial: TimelineFilters; spy: (k: TimelineFilterKey) => void }) {
  const [filters, setFilters] = useState(initial);
  return (
    <TimelineFilterMenu
      filters={filters}
      onToggleFilter={(k) => {
        spy(k);
        setFilters((f) => ({ ...f, [k]: !f[k] }));
      }}
    />
  );
}

function setup(initial = ALL) {
  const spy = vi.fn();
  render(<Harness initial={initial} spy={spy} />);
  return { spy, button: screen.getByRole('button', { name: /^Filtres de la timeline/ }) };
}

describe('TimelineFilterMenu', () => {
  it('shows no badge while every category is visible', () => {
    const { button } = setup();
    expect(button.getAttribute('aria-label')).toBe('Filtres de la timeline');
    expect(screen.queryByTestId('timeline-filter-badge')).toBeNull();
  });

  // The filters are persisted, so a hidden category must be visible without opening the menu.
  it('counts the hidden categories on the button and names them in its title', () => {
    const { button } = setup({ ...ALL, pr: false, comments: false });
    expect(screen.getByTestId('timeline-filter-badge').textContent).toBe('2');
    expect(button.getAttribute('aria-label')).toBe('Filtres de la timeline (2 masqués)');
    expect(button.getAttribute('title')).toBe('Masqués : PR, Commentaires');
  });

  it('lists the 5 categories in order, toggles immediately and stays open', () => {
    const { button, spy } = setup();
    fireEvent.click(button);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map((b) => b.parentElement!.textContent)).toEqual(['Statuts', 'CLI', 'PR', 'Livrables', 'Commentaires']);
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Commentaires' }));
    expect(spy).toHaveBeenCalledWith('comments');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Commentaires' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId('timeline-filter-badge').textContent).toBe('1');
  });

  it('offers "Tout afficher" only when something is hidden, and it shows everything back', () => {
    const { button } = setup();
    fireEvent.click(button);
    expect(screen.queryByRole('button', { name: 'Tout afficher' })).toBeNull();
    cleanup();
    const second = setup({ ...ALL, cli: false, pr: false });
    fireEvent.click(second.button);
    fireEvent.click(screen.getByRole('button', { name: 'Tout afficher' }));
    expect(second.spy.mock.calls.map((c) => c[0])).toEqual(['cli', 'pr']);
    expect(screen.queryByTestId('timeline-filter-badge')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tout afficher' })).toBeNull();
  });

  it('closes on Escape and on a second click of the button', () => {
    const { button } = setup();
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
