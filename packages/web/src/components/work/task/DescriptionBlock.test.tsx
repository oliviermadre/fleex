import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { TextareaHTMLAttributes } from 'react';

const updateTicket = vi.fn();
vi.mock('../../../stores/ticketStore', () => ({ useTicketStore: { getState: () => ({ updateTicket }) } }));
vi.mock('../../markdown/useAllMentionOptions', () => ({ useAllMentionOptions: () => [] }));
// The real editor (modes, uploads, preview) is out of scope here: a bare textarea
// that honours value / onChange / textareaProps is what the block drives.
vi.mock('../../markdown/MarkdownEditor', () => ({
  MarkdownEditor: ({
    value,
    onChange,
    textareaProps,
  }: {
    value: string;
    onChange: (v: string) => void;
    textareaProps?: TextareaHTMLAttributes<HTMLTextAreaElement>;
  }) => (
    <textarea
      aria-label="description editor"
      value={value}
      onKeyDown={textareaProps?.onKeyDown}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { DescriptionBlock } from './DescriptionBlock';

afterEach(cleanup);
beforeEach(() => {
  updateTicket.mockReset();
});

const editor = () => screen.getByLabelText('description editor') as HTMLTextAreaElement;

describe('DescriptionBlock', () => {
  it('is read-only outside the Work pane (no Edit, nothing for an empty description)', () => {
    const { container, rerender } = render(<DescriptionBlock ticketId="t1" description="Hello" />);
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
    rerender(<DescriptionBlock ticketId="t1" description={null} />);
    expect(container.textContent).toBe('');
  });

  it('opens the editor prefilled and saves the new description through the ticket store', async () => {
    updateTicket.mockResolvedValue(undefined);
    render(<DescriptionBlock ticketId="t1" description="Old" editable />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(editor().value).toBe('Old');
    fireEvent.change(editor(), { target: { value: 'New' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByLabelText('description editor')).toBeNull());
    expect(updateTicket).toHaveBeenCalledWith('t1', { description: 'New' });
  });

  it('saves with ⌘↵ and cancels with Esc without any API call', async () => {
    updateTicket.mockResolvedValue(undefined);
    render(<DescriptionBlock ticketId="t1" description="Old" editable />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    fireEvent.change(editor(), { target: { value: 'Draft' } });
    fireEvent.keyDown(editor(), { key: 'Escape' });
    expect(screen.queryByLabelText('description editor')).toBeNull();
    expect(screen.getByText('Old')).toBeTruthy();
    expect(updateTicket).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    fireEvent.change(editor(), { target: { value: 'Via shortcut' } });
    fireEvent.keyDown(editor(), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(updateTicket).toHaveBeenCalledWith('t1', { description: 'Via shortcut' }));
  });

  it('closes without an API call when nothing changed', () => {
    render(<DescriptionBlock ticketId="t1" description="Same" editable />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByLabelText('description editor')).toBeNull();
    expect(updateTicket).not.toHaveBeenCalled();
  });

  it('offers "+ Add a description" on an empty ticket and opens an empty editor', () => {
    render(<DescriptionBlock ticketId="t1" description={null} editable />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add a description' }));
    expect(editor().value).toBe('');
  });

  it('keeps the editor and the draft open with an error when the save fails', async () => {
    updateTicket.mockImplementation(async () => {
      throw new Error('500');
    });
    render(<DescriptionBlock ticketId="t1" description="Old" editable />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    fireEvent.change(editor(), { target: { value: 'Precious draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText("Couldn't save description")).toBeTruthy());
    expect(editor().value).toBe('Precious draft');
  });

  it('does not overwrite the draft when the ticket is updated elsewhere mid-edit', () => {
    const { rerender } = render(<DescriptionBlock ticketId="t1" description="Old" editable />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    fireEvent.change(editor(), { target: { value: 'Mine' } });
    rerender(<DescriptionBlock ticketId="t1" description="Theirs" editable />);
    expect(editor().value).toBe('Mine');
    fireEvent.keyDown(editor(), { key: 'Escape' });
    expect(screen.getByText('Theirs')).toBeTruthy();
  });
});
