import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const deleteDeliverable = vi.fn();
const addToast = vi.fn();
vi.mock('../../../services/api', () => ({
  deleteDeliverable: (t: string, d: string) => deleteDeliverable(t, d),
}));
vi.mock('../../../stores/toastStore', () => ({ useToastStore: { getState: () => ({ addToast }) } }));

import { DeleteDeliverableButton } from './DeleteDeliverableButton';

afterEach(cleanup);
beforeEach(() => {
  deleteDeliverable.mockReset();
  addToast.mockReset();
});

const deliv = { id: 'd1', title: 'SPEC v1' };

function renderInCard(onDeleted = vi.fn()) {
  // The host cards open the overlay on click — the trash must never trigger that.
  const openCard = vi.fn();
  render(
    <div onClick={openCard}>
      <DeleteDeliverableButton ticketId="t1" deliverable={deliv} onDeleted={onDeleted} />
    </div>,
  );
  return { openCard, onDeleted };
}

describe('DeleteDeliverableButton', () => {
  it('asks for confirmation first and never opens the card', () => {
    const { openCard } = renderInCard();
    fireEvent.click(screen.getByRole('button', { name: 'Delete deliverable' }));
    expect(screen.getByText('Delete deliverable?')).toBeTruthy();
    expect(screen.getByText('"SPEC v1" will be permanently deleted.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteDeliverable).not.toHaveBeenCalled();
    expect(openCard).not.toHaveBeenCalled();
  });

  it('deletes on confirm and drops the card at once', async () => {
    deleteDeliverable.mockResolvedValue(undefined);
    const { openCard, onDeleted } = renderInCard();
    fireEvent.click(screen.getByRole('button', { name: 'Delete deliverable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('d1'));
    expect(deleteDeliverable).toHaveBeenCalledWith('t1', 'd1');
    expect(openCard).not.toHaveBeenCalled();
  });

  it('keeps the card and reports when the API fails', async () => {
    deleteDeliverable.mockRejectedValue(new Error('boom'));
    const { onDeleted } = renderInCard();
    fireEvent.click(screen.getByRole('button', { name: 'Delete deliverable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('error', 'boom'));
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
