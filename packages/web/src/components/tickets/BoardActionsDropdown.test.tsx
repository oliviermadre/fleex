import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import type { BoardWithCounts } from '@fleex/shared';

const updateBoard = vi.fn();
vi.mock('../../stores/ticketStore', () => ({
  useTicketStore: (selector: (s: unknown) => unknown) =>
    selector({ updateBoard, deleteBoard: vi.fn(), boards: [{}, {}] }),
}));

import { BoardActionsDropdown } from './BoardActionsDropdown';

const board = { id: 'b1', name: 'Personal', emoji: '🏠' } as BoardWithCounts;

/** Open the pencil menu, then "Edit". Returns the two fields. */
function openEdit() {
  render(<BoardActionsDropdown board={board} />);
  fireEvent.click(screen.getByTitle('Board actions'));
  fireEvent.click(screen.getByText('Edit'));
  return {
    emoji: screen.getByLabelText('Emoji') as HTMLInputElement,
    name: screen.getByLabelText('Board name') as HTMLInputElement,
  };
}

beforeEach(() => updateBoard.mockReset());
afterEach(cleanup);

describe('BoardActionsDropdown — edit', () => {
  it('pre-fills the current emoji and name, with the name focused', () => {
    const { emoji, name } = openEdit();
    expect(emoji.value).toBe('🏠');
    expect(name.value).toBe('Personal');
    expect(document.activeElement).toBe(name);
  });

  it('Enter after changing only the emoji sends one PATCH with the emoji alone', () => {
    const { emoji } = openEdit();
    fireEvent.change(emoji, { target: { value: '🗺️' } });
    fireEvent.keyDown(emoji, { key: 'Enter' });
    expect(updateBoard).toHaveBeenCalledTimes(1);
    expect(updateBoard).toHaveBeenCalledWith('b1', { emoji: '🗺️' });
    expect(screen.queryByLabelText('Emoji')).toBeNull();
  });

  it('sends name and emoji in a single PATCH when both changed', () => {
    const { emoji, name } = openEdit();
    fireEvent.change(emoji, { target: { value: '🚀' } });
    fireEvent.change(name, { target: { value: 'Perso' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(updateBoard).toHaveBeenCalledTimes(1);
    expect(updateBoard).toHaveBeenCalledWith('b1', { name: 'Perso', emoji: '🚀' });
  });

  it('moving between the fields keeps the popover open and sends nothing', () => {
    const { emoji, name } = openEdit();
    fireEvent.change(name, { target: { value: 'Perso' } });
    act(() => emoji.focus());
    fireEvent.blur(name, { relatedTarget: emoji });
    expect(updateBoard).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Emoji')).toBeTruthy();
  });

  it('Escape closes without any API call, even with pending changes', () => {
    const { emoji } = openEdit();
    fireEvent.change(emoji, { target: { value: '🗺️' } });
    fireEvent.keyDown(emoji, { key: 'Escape' });
    expect(updateBoard).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Emoji')).toBeNull();
  });

  it('an outside click saves the pending changes', () => {
    const { name } = openEdit();
    fireEvent.change(name, { target: { value: 'Perso' } });
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);
    expect(updateBoard).toHaveBeenCalledTimes(1);
    expect(updateBoard).toHaveBeenCalledWith('b1', { name: 'Perso' });
  });

  it('an emptied emoji keeps the current one: nothing is sent', () => {
    const { emoji } = openEdit();
    fireEvent.change(emoji, { target: { value: '' } });
    fireEvent.keyDown(emoji, { key: 'Enter' });
    expect(updateBoard).not.toHaveBeenCalled();
  });
});
