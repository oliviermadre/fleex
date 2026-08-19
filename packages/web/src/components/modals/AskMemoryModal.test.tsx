import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AskMemoryModal } from './AskMemoryModal';
import { useUIStore } from '../../stores/uiStore';

const askMemory = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ askMemory }));

function answer(text: string, sources: unknown[] = []) {
  return { answer: text, sources };
}

beforeEach(() => {
  askMemory.mockReset();
  askMemory.mockResolvedValue(answer('Une réponse.'));
  useUIStore.setState({ askMemoryQuestion: 'routines' });
});

afterEach(() => {
  cleanup();
  useUIStore.setState({ askMemoryQuestion: null });
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
    // Retrieval returns up to two chunks per document; the list used to show the
    // same title twice and take half the panel for it.
    askMemory.mockResolvedValue(answer('Réponse [1] [2].', [
      { sourceKind: 'deliverable', sourceId: 'd1', title: 'Routines — 5 axes (3/13)', content: 'a', score: 0.7 },
      { sourceKind: 'deliverable', sourceId: 'd1', title: 'Routines — 5 axes (7/13)', content: 'b', score: 0.7 },
      { sourceKind: 'ticket', sourceId: 't1', title: 'Ticket #539', content: 'c', score: 0.6, ticketId: 't1' },
    ]));

    // Queried from the document: the Modal renders through a portal, so the render
    // container holds none of it.
    const { getByText, baseElement } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText('3 sources')).toBeTruthy());

    expect(baseElement.querySelectorAll('ol > li')).toHaveLength(2);
    // Both numbers on the shared row, and the chunk counter gone from the label.
    expect(getByText('[1][2]')).toBeTruthy();
    expect(getByText('Routines — 5 axes')).toBeTruthy();
  });

  it('reports a refusal instead of an empty panel', async () => {
    askMemory.mockResolvedValue({ answer: null, sources: [], reason: 'no_results' });
    const { getByText } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText(/Nothing indexed relates/)).toBeTruthy());
  });
});
