import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { AskMemoryModal } from './AskMemoryModal';
import { useUIStore } from '../../stores/uiStore';

const askMemoryStream = vi.hoisted(() => vi.fn());
const fetchDeliverable = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ askMemoryStream, fetchDeliverable }));

/** Stands in for the streaming call: replays stages, then resolves the answer. */
function streaming(result: unknown, stages: unknown[] = []) {
  return async (_q: string, onStage: (s: unknown) => void) => {
    for (const stage of stages) onStage(stage);
    return result;
  };
}

/** Resolves only when released, so the loading state can be inspected. */
function pending(stages: unknown[]) {
  let release: (v: unknown) => void = () => {};
  const gate = new Promise((r) => { release = r; });
  const fn = async (_q: string, onStage: (s: unknown) => void) => {
    for (const stage of stages) onStage(stage);
    return gate;
  };
  return { fn, release: () => release({ answer: 'done', sources: [] }) };
}

function answer(text: string, sources: unknown[] = []) {
  return { answer: text, sources };
}

beforeEach(() => {
  askMemoryStream.mockReset();
  fetchDeliverable.mockReset();
  askMemoryStream.mockImplementation(streaming(answer('Une réponse.')));
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
    await waitFor(() => expect(askMemoryStream).toHaveBeenCalledWith('routines', expect.any(Function), expect.any(Function)));
  });

  it('starts the input on what was asked, so a follow-up is an edit', async () => {
    const { getByPlaceholderText } = render(<AskMemoryModal />);
    await waitFor(() => expect(askMemoryStream).toHaveBeenCalled());
    expect((getByPlaceholderText('Ask something else…') as HTMLInputElement).value).toBe('routines');
  });

  it('asks a different question from the panel, without reopening the palette', async () => {
    const { getByPlaceholderText } = render(<AskMemoryModal />);
    await waitFor(() => expect(askMemoryStream).toHaveBeenCalledTimes(1));

    const input = getByPlaceholderText('Ask something else…');
    fireEvent.change(input, { target: { value: 'comment marche le scheduler' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(askMemoryStream)
      .toHaveBeenLastCalledWith('comment marche le scheduler', expect.any(Function), expect.any(Function)));
    // The header follows what was actually asked.
    expect(useUIStore.getState().askMemoryQuestion).toBe('comment marche le scheduler');
  });

  it('re-runs an unchanged question rather than doing nothing', async () => {
    // Store state would not move, so the effect would never fire — a retry has to
    // be dispatched directly.
    const { getByPlaceholderText } = render(<AskMemoryModal />);
    await waitFor(() => expect(askMemoryStream).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(getByPlaceholderText('Ask something else…'), { key: 'Enter' });
    await waitFor(() => expect(askMemoryStream).toHaveBeenCalledTimes(2));
  });

  it('ignores an empty question', async () => {
    const { getByPlaceholderText } = render(<AskMemoryModal />);
    await waitFor(() => expect(askMemoryStream).toHaveBeenCalledTimes(1));

    const input = getByPlaceholderText('Ask something else…');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(askMemoryStream).toHaveBeenCalledTimes(1);
  });

  it('groups the sources of one document under a single row', async () => {
    // Retrieval returns several chunks per document; the list used to show the
    // same title twice and take half the panel for it.
    askMemoryStream.mockImplementation(streaming(answer('Réponse [1] [2].', [
      { sourceKind: 'deliverable', sourceId: 'd1', title: 'Routines — 5 axes (3/13)', content: 'a', score: 0.7 },
      { sourceKind: 'deliverable', sourceId: 'd1', title: 'Routines — 5 axes (7/13)', content: 'b', score: 0.7 },
      { sourceKind: 'ticket', sourceId: 't1', title: 'Ticket #539', content: 'c', score: 0.6, ticketId: 't1' },
    ])));

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
    askMemoryStream.mockImplementation(streaming(answer('Réponse [1].', [
      { sourceKind: 'deliverable', sourceId: 'd1', title: 'OKR Q3', content: 'a', score: 0.7 },
      { sourceKind: 'deliverable', sourceId: 'd2', title: 'Monthly coffee', content: 'b', score: 0.6 },
    ])));

    const { getByText, baseElement } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText('1 cited of 2 retrieved')).toBeTruthy());
    expect(baseElement.querySelectorAll('ol > li')).toHaveLength(1);

    fireEvent.click(getByText('Show 1 retrieved but not cited'));
    expect(baseElement.querySelectorAll('ol > li')).toHaveLength(2);
    expect(getByText('Monthly coffee')).toBeTruthy();
  });

  it('lists every source when the answer cited none', async () => {
    askMemoryStream.mockImplementation(streaming(answer('Pas de citation ici.', [
      { sourceKind: 'deliverable', sourceId: 'd1', title: 'OKR Q3', content: 'a', score: 0.7 },
    ])));

    const { getByText, baseElement } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText('1 retrieved')).toBeTruthy());
    expect(baseElement.querySelectorAll('ol > li')).toHaveLength(1);
  });

  it('opens a document that belongs to no ticket', async () => {
    // A routine produces deliverables outside any ticket. Those rows used to be
    // inert text, and they ranked first — so the top of the list was the part
    // nothing could be done with.
    fetchDeliverable.mockResolvedValue({ id: 'd1', title: 'OKR Q3' });
    askMemoryStream.mockImplementation(streaming(answer('Réponse [1].', [
      { sourceKind: 'deliverable', sourceId: 'd1', title: 'OKR Q3', content: 'a', score: 0.7 },
    ])));

    const { getByText } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText('OKR Q3')).toBeTruthy());

    fireEvent.click(getByText('OKR Q3'));
    await waitFor(() => expect(fetchDeliverable).toHaveBeenCalledWith('d1'));
    await waitFor(() => expect(useUIStore.getState().deliverableOverlay).toMatchObject({ id: 'd1' }));
  });

  it('reports why answering failed, not just that it did', async () => {
    // A timeout says the encoder may still be loading, which the reader can act
    // on. "Could not reach memory" threw that away.
    askMemoryStream.mockRejectedValue(new Error('Answering took longer than 180s.'));
    const { getByText } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText(/longer than 180s/)).toBeTruthy());
  });

  it('reports a refusal instead of an empty panel', async () => {
    askMemoryStream.mockImplementation(streaming({ answer: null, sources: [], reason: 'no_results' }));
    const { getByText } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText(/Nothing indexed relates/)).toBeTruthy());
  });
});

/**
 * Ten seconds of real work behind one frozen line read as nothing happening.
 */
describe('AskMemoryModal — progress', () => {
  it('shows each stage the server reports, keeping the finished ones', async () => {
    const { fn, release } = pending([
      { stage: 'encoding' },
      { stage: 'searching' },
      { stage: 'retrieved', passages: 12, documents: 8 },
    ]);
    askMemoryStream.mockImplementation(fn);

    const { getByText } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText('Encoding the question')).toBeTruthy());
    expect(getByText('Searching what this workspace remembers')).toBeTruthy();
    expect(getByText('Found 12 passages across 8 documents')).toBeTruthy();

    release();
  });

  it('names the documents being read, not just how many', async () => {
    // The part of the wait that tells the reader whether the answer is going to
    // be any good.
    const { fn, release } = pending([
      { stage: 'reading', titles: ['OKR Q3 (Variable Q3) (2/4)', 'PRD v2 — Routines'] },
    ]);
    askMemoryStream.mockImplementation(fn);

    const { getByText } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText('Reading the closest documents in full')).toBeTruthy());
    // The chunk counter is bookkeeping and is stripped, as everywhere else.
    expect(getByText('OKR Q3 (Variable Q3)')).toBeTruthy();
    expect(getByText('PRD v2 — Routines')).toBeTruthy();

    release();
  });

  it('replaces the progress with the answer once it lands', async () => {
    askMemoryStream.mockImplementation(streaming(answer('La réponse.'), [{ stage: 'drafting' }]));
    const { getByText, queryByText } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText('La réponse.')).toBeTruthy());
    expect(queryByText('Drafting the answer')).toBeNull();
  });

  it('says something before the first stage arrives', async () => {
    const { fn, release } = pending([]);
    askMemoryStream.mockImplementation(fn);

    const { getByText } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText('Starting…')).toBeTruthy());

    release();
  });
});

/**
 * The answer as it is written.
 *
 * Measured on a live instance: retrieval takes 0.6 s and the model 13.1 s. Naming
 * the stages left 95% of the wait under one unmoving line, which is the thing that
 * looked frozen in the first place.
 */
describe('AskMemoryModal — streamed answer', () => {
  /** Replays stages, then deltas, and waits before resolving. */
  function drafting(stages: unknown[], deltas: string[]) {
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((r) => { release = r; });
    const fn = async (
      _q: string,
      onStage: (s: unknown) => void,
      onDelta: (t: string) => void,
    ) => {
      for (const stage of stages) onStage(stage);
      for (const delta of deltas) onDelta(delta);
      return gate;
    };
    return { fn, release: () => release({ answer: deltas.join(''), sources: [] }) };
  }

  it('shows the answer while it is still being written', async () => {
    const { fn, release } = drafting([{ stage: 'drafting' }], ['Une **routine** ', 'est un workflow']);
    askMemoryStream.mockImplementation(fn);

    const { getByText, container } = render(<AskMemoryModal />);
    // Rendered as markdown while it grows, so the layout does not jump at the end.
    await waitFor(() => expect(getByText(/est un workflow/)).toBeTruthy());
    expect(container.ownerDocument.querySelector('strong')?.textContent).toBe('routine');

    release();
  });

  it('gives the writing the floor once it starts', async () => {
    // The stage list describes a second of work; the text is the other thirteen.
    const { fn, release } = drafting([{ stage: 'drafting' }], ['Voici']);
    askMemoryStream.mockImplementation(fn);

    const { queryByText, getByText } = render(<AskMemoryModal />);
    await waitFor(() => expect(getByText(/Voici/)).toBeTruthy());
    expect(queryByText('Drafting the answer')).toBeNull();

    release();
  });
});

describe('AskMemoryModal — the wait shows time passing', () => {
  it('counts seconds on the stage in progress', async () => {
    // Drafting waits about ten seconds before the model's first word. A line that
    // never changes for ten seconds is what looked broken.
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((r) => { release = r; });
    askMemoryStream.mockImplementation(async (_q: string, onStage: (s: unknown) => void) => {
      onStage({ stage: 'drafting' });
      return gate;
    });

    // Installed before render: the interval has to be the fake one to be advanced.
    vi.useFakeTimers();
    try {
      const { getByText, queryByText } = render(<AskMemoryModal />);
      await act(async () => {});
      expect(getByText('Drafting the answer')).toBeTruthy();
      // Quiet at first, so the sub-second stages do not flicker a counter.
      expect(queryByText('1s')).toBeNull();

      await act(async () => { vi.advanceTimersByTime(3000); });
      expect(getByText('3s')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
    release({ answer: 'done', sources: [] });
  });
});
