import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { Ticket } from '@fleex/shared';
import { ScratchpadMainView } from './ScratchpadMainView';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useTicketStore } from '../../stores/ticketStore';

function ticket(id: string, displayId: number, title: string): Ticket {
  return { id, displayId, title, boardId: 'b1' } as unknown as Ticket;
}

beforeEach(() => {
  // jsdom has no layout engine and no scrollIntoView — MentionMenu calls it
  // whenever the selected row changes (same convention as SmartSessionButton).
  Element.prototype.scrollIntoView = vi.fn();
  useTicketStore.setState({ tickets: [ticket('t1', 42, 'Session tokens expire early')] });
  useScratchpadStore.setState({
    entries: { __global__: { content: '', loaded: true, saving: false, savedAt: null, dirty: false } },
    scratchpadList: [
      { key: '__global__', label: 'Global', lineCount: 3 },
      { key: 'acme/app', label: 'acme/app', lineCount: 0 },
    ],
    scratchpadListLoaded: true,
  });
});

afterEach(() => {
  cleanup();
  useTicketStore.setState({ tickets: [] });
});

function typeAt(el: HTMLTextAreaElement, value: string) {
  // Note: `value`/`selectionStart` must NOT be pre-assigned on `el` before this
  // call. React 19 tracks the DOM node's "last known value" through its own
  // property-setter override, including direct assignments from outside React
  // (e.g. `el.value = value`) — so a manual pre-assignment already syncs that
  // tracker, and the subsequent event then looks like a no-op change to React,
  // which never invokes `onChange`. `fireEvent`'s `target` override uses the
  // underlying native setter instead, keeping React's tracker stale so it
  // correctly detects the change and fires `onChange` when the event dispatches.
  fireEvent.change(el, { target: { value, selectionStart: value.length } });
}

// The note editor offers only what navigates somewhere: an agent or a skill
// dispatches nothing from a note and renders no chip there, so offering it would
// insert dead text.
describe('ScratchpadMainView — mention autocomplete', () => {
  it('offers the notes on a bare @', () => {
    // Scoped to the button role: the title bar also reads "Global" (the label
    // of the note currently open), so a plain text query would be ambiguous
    // between that header and the dropdown option.
    const { container, getByRole } = render(<ScratchpadMainView scratchpadKey="__global__" />);
    typeAt(container.querySelector('textarea')!, '@');
    expect(getByRole('button', { name: /Global/ })).toBeTruthy();
    expect(getByRole('button', { name: /acme\/app/ })).toBeTruthy();
  });

  it('offers no agent, skill, panel or workflow', () => {
    const { container, queryByText } = render(<ScratchpadMainView scratchpadKey="__global__" />);
    typeAt(container.querySelector('textarea')!, '@');
    expect(queryByText('agent')).toBeNull();
    expect(queryByText('skill')).toBeNull();
    expect(queryByText('panel')).toBeNull();
    expect(queryByText('workflow')).toBeNull();
  });

  it('offers a ticket once a query narrows it', () => {
    const { container, getByText } = render(<ScratchpadMainView scratchpadKey="__global__" />);
    typeAt(container.querySelector('textarea')!, '@token');
    expect(getByText('#42 Session tokens expire early')).toBeTruthy();
  });

  it('inserts the reference syntax for the chosen note', () => {
    const { container, getByText } = render(<ScratchpadMainView scratchpadKey="__global__" />);
    const ta = container.querySelector('textarea')!;
    typeAt(ta, 'see @acme');
    fireEvent.mouseDown(getByText('acme/app'));
    expect(useScratchpadStore.getState().entries['__global__']?.content).toBe('see @scratchpad:acme/app ');
  });

  it('inserts the global note as @scratchpad:global, not its storage key', () => {
    // Same title-bar ambiguity as above — click the dropdown option specifically.
    const { container, getByRole } = render(<ScratchpadMainView scratchpadKey="__global__" />);
    typeAt(container.querySelector('textarea')!, '@Glob');
    fireEvent.mouseDown(getByRole('button', { name: /Global/ }));
    expect(useScratchpadStore.getState().entries['__global__']?.content).toBe('@scratchpad:global ');
  });
});
