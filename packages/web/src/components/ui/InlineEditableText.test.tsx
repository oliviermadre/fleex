import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { InlineEditableText } from './InlineEditableText';

afterEach(cleanup);

function setup(onCommit = vi.fn(async () => {})) {
  render(<InlineEditableText value="Foo" onCommit={onCommit} ariaLabel="Title" maxLength={200} />);
  fireEvent.click(screen.getByRole('button', { name: 'Foo' }));
  return { onCommit, input: screen.getByLabelText('Title') as HTMLInputElement };
}

describe('InlineEditableText', () => {
  it('a click edits in place: focused input, whole text selected, length capped', () => {
    const { input } = setup();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
    expect(input.maxLength).toBe(200);
  });

  it('Enter commits the trimmed value once, even with the blur that follows', async () => {
    const { input, onCommit } = setup();
    fireEvent.change(input, { target: { value: '  Bar  ' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('Bar');
  });

  it('blur commits too', async () => {
    const { input, onCommit } = setup();
    fireEvent.change(input, { target: { value: 'Bar' } });
    await act(async () => { fireEvent.blur(input); });
    expect(onCommit).toHaveBeenCalledWith('Bar');
  });

  it('Esc cancels without calling anything, even with the blur that follows', async () => {
    // WHY: Esc is "I changed my mind" — a network call (and an activity row) would be wrong.
    const { input, onCommit } = setup();
    fireEvent.change(input, { target: { value: 'Bar' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' });
      fireEvent.blur(input);
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Foo' })).toBeTruthy();
  });

  it.each([['empty', ''], ['blank', '   '], ['unchanged', ' Foo ']])('a %s value makes no call', async (_, value) => {
    // WHY: an empty title is refused by the server anyway, and an unchanged one is a no-op write.
    const { input, onCommit } = setup();
    fireEvent.change(input, { target: { value } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Foo' })).toBeTruthy();
  });

  it('disables the input while saving, then shows the original value again when the save fails', async () => {
    let reject!: (e: Error) => void;
    const onCommit = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
    const { input } = setup(onCommit);
    fireEvent.change(input, { target: { value: 'Bar' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(input.disabled).toBe(true);
    expect(input.value).toBe('Bar');
    await act(async () => { reject(new Error('400')); });
    expect(screen.getByRole('button', { name: 'Foo' })).toBeTruthy();
  });
});
