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

describe('useWorkKeyboard — ⌥T toggles the Timeline drawer', () => {
  function pressAltT(target: EventTarget = window) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: '†', code: 'KeyT', altKey: true, bubbles: true }));
  }

  beforeEach(() => {
    useWorkStore.setState({ view: 'task', shellOpen: true, timelineOpen: false });
  });

  it('opens the Timeline (closing the shell drawer) then closes it', () => {
    render(<Harness />);
    pressAltT();
    expect([useWorkStore.getState().timelineOpen, useWorkStore.getState().shellOpen]).toEqual([true, false]);
    pressAltT();
    expect(useWorkStore.getState().timelineOpen).toBe(false);
  });

  it('does nothing while typing in a field (⌥T types a character on macOS)', () => {
    render(<Harness />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    pressAltT(input);
    expect(useWorkStore.getState().timelineOpen).toBe(false);
    input.remove();
  });
});
