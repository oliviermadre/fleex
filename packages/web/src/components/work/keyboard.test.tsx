import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useWorkKeyboard } from './keyboard';
import { useWorkStore } from '../../stores/workStore';

/** A host that just mounts the work keyboard map. */
function Harness() {
  useWorkKeyboard([]);
  return null;
}

function pressEscape() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
  useWorkStore.setState({ view: 'new' });
});
afterEach(cleanup);

describe('useWorkKeyboard — Esc in the new-task view', () => {
  it('does NOT close while on the ENTRY / RESOLVING stage (those screens own Esc)', () => {
    // Resolving keeps the draft on the entry stage until a preview lands.
    useWorkStore.getState().updateDraft({ stage: 'entry' });
    render(<Harness />);

    pressEscape();

    expect(useWorkStore.getState().view).toBe('new');
  });

  it('closes the composer on Esc once the draft reached the compose stage', () => {
    useWorkStore.getState().updateDraft({ stage: 'compose', title: 'Task' });
    render(<Harness />);

    pressEscape();

    expect(useWorkStore.getState().view).toBe('task');
  });
});
