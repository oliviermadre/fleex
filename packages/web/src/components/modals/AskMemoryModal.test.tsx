import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AskMemoryModal } from './AskMemoryModal';
import { useUIStore } from '../../stores/uiStore';

const askMemory = vi.hoisted(() => vi.fn());
const fetchDeliverable = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ askMemory, fetchDeliverable }));

function answer(text: string, sources: unknown[] = []) {
  return { answer: text, sources };
}

beforeEach(() => {
  askMemory.mockReset();
  fetchDeliverable.mockReset();
  askMemory.mockResolvedValue(answer('Une réponse.'));
  useUIStore.setState({ askMemoryQuestion: 'routines' });
});

afterEach(() => {
  cleanup();
  useUIStore.setState({ askMemoryQuestion: null, deliverableOverlay: null });
});

/**
 * The panel is a single exchange, and an answer can end on a clarifying question.
 * Without an input that was a dead end — the only button re-ran the identical
 * query. These cover the way out.
 */
describe('AskMemoryModal', () => {
  it('answers the question it was opened with', async () => {
    render(<AskMemoryModal />);
    await waitFor(() => expect(askMemory).toHaveBeenCalledWith('routines'));
  });

  it('starts the input on what was asked, so a follow-up is an edit', async () => {
    const { getByPlaceholderText } = render(<AskMemoryModal />);
    await waitFor(() => expect(askMemory).toHaveBeenCalled());
    expect((getByPlaceholderText('Ask something else…') as HTMLInputElement).value).toBe('routines');
  });

  it('asks a different question from the panel, without reopening the palette', async () => {
    const { getByPlaceholderText } = render(<AskMemoryModal />);
    await waitFor(() => expect(askMemory).toHaveBeenCalledTimes(1));

    const input = getByPlaceholderText('Ask something else…');
    fireEvent.change(input, { target: { value: 'comment marche le scheduler' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(askMemory).toHaveBeenLastCalledWith('comment marche le scheduler'));
    // The header follows what was actually asked.
    expect(useUIStore.getState().askMemoryQuestion).toBe('comment marche le scheduler');
  });

  it('re-runs an unchanged question rather than doing nothing', async () => {
    // Store state would not move, so the effect would never fire — a retry has to
    // be dispatched directly.
    const { getByPlaceholderText } = render(<AskMemoryModal />);
    await waitFor(() => expect(askMemory).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(getByPlaceholderText('Ask something else…'), { key: 'Enter' });
    await waitFor(() => expect(askMemory).toHaveBeenCalledTimes(2));
  });

  it('ignores an empty question', async () => {
    const { getByPlaceholderText } = render(<AskMemoryModal />);
    await waitFor(() => expect(askMemory).toHaveBeenCalledTimes(1));

    const input = getByPlaceholderText('Ask something else…');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(askMemory).toHaveBeenCalledTimes(1);
  });

  it('groups the sources of one document under a single row', async () => {
    // Retrieval returns several chunks per document; the list used to show the
    // same title twice and take half the panel for it.
    askMemory.mockResolvedValue(answer('Réponse [1] [2].', [
      { sourceKind: 'deliverable', sourceId: 'd1', title: 'Routines — 5 axes (3/13)', content: 'a', score: 0.7 },
      { sourceKind: 'deliverable', sourceId: 'd1', title: 'Routines — 5 axes (7/13)', content: 'b', score: 0.7 },
      { sourceKind: 'ticket', sourceId: 't1', title: 'Ticket #539', content: 'c', score: 0.6, ticketId: 't1' },
    ]));

    // Queried from the document: the Modal renders through a portal, so the render
    // container holds none of it.
    const { getByText, baseElement } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText('1 cited of 2 retrieved')).toBeTruthy());

    // Only the cited document is listed up front; the ticket nobody cited waits
    // behind the toggle.
    expect(baseElement.querySelectorAll('ol > li')).toHaveLength(1);
    // Both numbers on the shared row, and the chunk counter gone from the label.
    expect(getByText('[1][2]')).toBeTruthy();
    expect(getByText('Routines — 5 axes')).toBeTruthy();
  });

  it('keeps the uncited sources one click away', async () => {
    // Retrieval hands the model far more than it uses — four of eighteen, on the
    // question that prompted this. Hiding them outright would be dishonest;
    // listing them alongside the evidence buried it.
    askMemory.mockResolvedValue(answer('Réponse [1].', [
      { sourceKind: 'deliverable', sourceId: 'd1', title: 'OKR Q3', content: 'a', score: 0.7 },
      { sourceKind: 'deliverable', sourceId: 'd2', title: 'Monthly coffee', content: 'b', score: 0.6 },
    ]));

    const { getByText, baseElement } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText('1 cited of 2 retrieved')).toBeTruthy());
    expect(baseElement.querySelectorAll('ol > li')).toHaveLength(1);

    fireEvent.click(getByText('Show 1 retrieved but not cited'));
    expect(baseElement.querySelectorAll('ol > li')).toHaveLength(2);
    expect(getByText('Monthly coffee')).toBeTruthy();
  });

  it('lists every source when the answer cited none', async () => {
    askMemory.mockResolvedValue(answer('Pas de citation ici.', [
      { sourceKind: 'deliverable', sourceId: 'd1', title: 'OKR Q3', content: 'a', score: 0.7 },
    ]));

    const { getByText, baseElement } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText('1 retrieved')).toBeTruthy());
    expect(baseElement.querySelectorAll('ol > li')).toHaveLength(1);
  });

  it('opens a document that belongs to no ticket', async () => {
    // A routine produces deliverables outside any ticket. Those rows used to be
    // inert text, and they ranked first — so the top of the list was the part
    // nothing could be done with.
    fetchDeliverable.mockResolvedValue({ id: 'd1', title: 'OKR Q3' });
    askMemory.mockResolvedValue(answer('Réponse [1].', [
      { sourceKind: 'deliverable', sourceId: 'd1', title: 'OKR Q3', content: 'a', score: 0.7 },
    ]));

    const { getByText } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText('OKR Q3')).toBeTruthy());

    fireEvent.click(getByText('OKR Q3'));
    await waitFor(() => expect(fetchDeliverable).toHaveBeenCalledWith('d1'));
    await waitFor(() => expect(useUIStore.getState().deliverableOverlay).toMatchObject({ id: 'd1' }));
  });

  it('reports why answering failed, not just that it did', async () => {
    // A timeout says the encoder may still be loading, which the reader can act
    // on. "Could not reach memory" threw that away.
    askMemory.mockRejectedValue(new Error('Answering took longer than 180s.'));
    const { getByText } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText(/longer than 180s/)).toBeTruthy());
  });

  it('reports a refusal instead of an empty panel', async () => {
    askMemory.mockResolvedValue({ answer: null, sources: [], reason: 'no_results' });
    const { getByText } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText(/Nothing indexed relates/)).toBeTruthy());
  });
});
