import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { TicketDeliverable } from '@fleex/shared';

vi.mock('../../services/api', () => ({
  createDeliverable: vi.fn(),
  createStandaloneDeliverable: vi.fn(),
}));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../markdown/MarkdownEditor', () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Content" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import * as api from '../../services/api';
import { toast } from '../../lib/toast';
import { DeliverableFormModal } from './DeliverableFormModal';

const created = { id: 'd-1', title: 'Msg Unipile' } as TicketDeliverable;

beforeEach(() => {
  vi.mocked(api.createDeliverable).mockResolvedValue(created);
  vi.mocked(api.createStandaloneDeliverable).mockResolvedValue(created);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save deliverable' }));

describe('<DeliverableFormModal/>', () => {
  it('on a ticket: unchanged — same heading, ticket route, its own toast', async () => {
    render(<DeliverableFormModal open onClose={() => {}} ticketId="t-1" />);
    expect(screen.getByText('Add deliverable')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Deliverable title'), { target: { value: 'Notes' } });
    save();

    await waitFor(() => expect(api.createDeliverable).toHaveBeenCalledWith('t-1', {
      title: 'Notes', type: 'report', content: '', status: 'final', agentName: 'user',
    }));
    expect(api.createStandaloneDeliverable).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Deliverable created');
  });

  it('without a ticket: creates a standalone document and hands it to the caller', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<DeliverableFormModal open onClose={onClose} initialTitle="Msg Unipile" onCreated={onCreated} />);
    expect(screen.getByText('New document')).toBeTruthy();
    // Pre-filled, and an empty content is allowed.
    expect((screen.getByPlaceholderText('Deliverable title') as HTMLInputElement).value).toBe('Msg Unipile');
    save();

    await waitFor(() => expect(api.createStandaloneDeliverable).toHaveBeenCalledWith({
      title: 'Msg Unipile', type: 'report', content: '', status: 'final',
    }));
    expect(api.createDeliverable).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith(created);
    // The caller owns the feedback ("Document created", "created and attached").
    expect(toast.success).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('still requires a title', async () => {
    render(<DeliverableFormModal open onClose={() => {}} />);
    save();
    expect(await screen.findByText('Title is required')).toBeTruthy();
    expect(api.createStandaloneDeliverable).not.toHaveBeenCalled();
  });
});
