/**
 * The card a click on a ticket opens beside its machine. Its fields are the composer every other Fleex field uses:
 * an answer or a gate's reason can carry markdown and a pasted screenshot, not just one line of plain text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import * as api from '../services/api';
import { FactoryPeek } from './FactoryPeek';
import { useFactoryStore } from './factoryStore';
import { factoryApi } from './factoryApi';
import type { AgentExecution, TicketComment } from '@fleex/shared';
import type { FactoryRun, FactorySnapshot, FactoryTicket, MachineSpec, TicketPhase } from './types';

vi.mock('../services/api', async (original) => ({
  ...(await original<typeof import('../services/api')>()),
  fetchTicketComments: vi.fn(async () => []),
  postTicketComment: vi.fn(async () => ({})),
  uploadFile: vi.fn(async () => ({ originalName: 'shot.png', url: '/api/files/shot.png' })),
  fetchExecutionsForTicket: vi.fn(async () => []),
  cancelExecution: vi.fn(async () => ({})),
}));
vi.mock('./factoryApi', async (original) => {
  const real = await original<typeof import('./factoryApi')>();
  return { factoryApi: { ...real.factoryApi, runs: vi.fn(async () => []) } };
});
/* the real stream loads and subscribes through the event store: here it only says which execution it shows */
vi.mock('../components/main-panel/AgentEventStream', () => ({ AgentEventStream: ({ executionId }: { executionId: string }) => <div data-testid="stream" data-execution-id={executionId} /> }));
vi.mock('../components/work/panel/useTicketDeliverables', () => ({ useTicketDeliverables: () => ({ deliverables: [], loading: false, removeDeliverable: () => {} }) }));
vi.mock('../hooks/useExecConfig', () => ({ useExecConfig: () => ({ cycleMode: () => {}, setExecutionMode: () => {} }) }));
vi.mock('../stores/panelStore', () => ({ usePanelStore: (pick: (s: unknown) => unknown) => pick({ loadPanels: async () => {}, panels: [] }) }));
vi.mock('../stores/skillStore', () => ({ useSkillStore: (pick: (s: unknown) => unknown) => pick({ loadSkills: async () => {}, skills: [] }) }));
vi.mock('../stores/workflowTemplateStore', () => ({ useWorkflowTemplateStore: (pick: (s: unknown) => unknown) => pick({ refresh: async () => {}, templates: [] }) }));
vi.mock('../components/markdown/useAllMentionOptions', () => ({ useAllMentionOptions: () => [] }));

const dev: MachineSpec = { id: 'dev', kind: 'station', x: 1, y: 1, w: 5, h: 4, name: 'Dev', exec: 'agent', ref: 'builder', outcomes: ['done'], cap: 2 };
const gate: MachineSpec = { id: 'qa', kind: 'station', x: 8, y: 1, w: 5, h: 4, name: 'Check spec', exec: 'human_gate', outcomes: ['approve', 'reject'], cap: 8 };

const ticket = (machineId: string, phase: TicketPhase): FactoryTicket =>
  ({ ticketId: 't1', machineId, info: { id: 't1', displayId: 7, title: 'Ticket t1', type: 'build', priority: 'medium', status: 'doing', tags: [], boardId: 'b1', complexity: null, favorite: false, blocked: false }, x: 0, y: 0, phase, p: 0, fx: 1, fy: 0, outcome: '', released: false, since: '2026-11-15T09:00:00.000Z', runId: null, note: '', handedAt: '' });

function seed(t: FactoryTicket, serverTime = '2026-11-15T10:00:00.000Z') {
  const layout = { version: 2, w: 30, h: 12, machines: [dev, gate] };
  const snapshot: FactorySnapshot = { floor: { id: 'f', name: 'Floor', layout, settings: { maxRunsPerHour: 20, maxConcurrentRuns: 3 } }, tickets: [t], arms: [], runsLastHour: 0, running: 0, serverTime };
  const resolve = vi.fn(async () => {});
  useFactoryStore.setState({ enabled: true, snapshot, layout, resolve, putBack: vi.fn(async () => {}) });
  return { resolve };
}
const open = () => { const on = { onOpen: vi.fn(), onClose: vi.fn() }; render(<FactoryPeek ticketId="t1" {...on} />); return on; };
const openWithPopOut = () => { const on = { onOpen: vi.fn(), onClose: vi.fn(), onPopOut: vi.fn() }; render(<FactoryPeek ticketId="t1" {...on} />); return on; };
const paste = (field: HTMLElement, file: File) => fireEvent.paste(field, { clipboardData: { files: [file] } });
const shot = () => new File(['png'], 'shot.png', { type: 'image/png' });

afterEach(() => { cleanup(); });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(factoryApi.runs).mockResolvedValue([]); });

describe('<FactoryPeek/> reply', () => {
  it('posts a several-line markdown answer with a pasted screenshot, then empties the field', async () => {
    seed(ticket('dev', 'question'));
    open();
    const field = screen.getByPlaceholderText(/station takes the ticket again/) as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    fireEvent.change(field, { target: { value: 'See **this**\n' } });
    field.setSelectionRange(field.value.length, field.value.length);
    await act(async () => { paste(field, shot()); });
    await waitFor(() => expect(field.value).toBe('See **this**\n![shot.png](/api/files/shot.png)'));

    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(api.postTicketComment).toHaveBeenCalledWith('t1', 'See **this**\n![shot.png](/api/files/shot.png)'));
    await waitFor(() => expect(field.value).toBe(''));
  });

  it('Shift+Enter is a newline, not a send', () => {
    seed(ticket('dev', 'question'));
    open();
    const field = screen.getByPlaceholderText(/station takes the ticket again/);
    fireEvent.change(field, { target: { value: 'line one' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(api.postTicketComment).not.toHaveBeenCalled();
  });

  it('keeps the answer when the post fails, so nothing typed is lost', async () => {
    vi.mocked(api.postTicketComment).mockRejectedValueOnce(new Error('down'));
    seed(ticket('dev', 'question'));
    open();
    const field = screen.getByPlaceholderText(/station takes the ticket again/) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'my answer' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(api.postTicketComment).toHaveBeenCalled());
    expect(field.value).toBe('my answer');
  });

  it('Escape in an empty field closes the card; with text it only leaves the field', () => {
    seed(ticket('dev', 'question'));
    const on = open();
    const field = screen.getByPlaceholderText(/station takes the ticket again/);
    field.focus();
    fireEvent.change(field, { target: { value: 'draft' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(on.onClose).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(field);
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(on.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('<FactoryPeek/> at a gate', () => {
  it('sends the reason, markdown and screenshot included, with the decision', async () => {
    const { resolve } = seed(ticket('qa', 'review'));
    open();
    const field = screen.getByPlaceholderText(/Reason \(optional\)/) as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    fireEvent.change(field, { target: { value: 'Not yet:\n- fix the header\n' } });
    field.setSelectionRange(field.value.length, field.value.length);
    await act(async () => { paste(field, shot()); });
    await waitFor(() => expect(field.value).toContain('![shot.png](/api/files/shot.png)'));

    /* Enter is a newline here: only a decision button sends the reason */
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('reject'));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith('t1', 'reject', 'Not yet:\n- fix the header\n![shot.png](/api/files/shot.png)'));
  });
});

const runRow = (id: string, executionId: string | null, status: FactoryRun['status'], machineName = 'Dev', startedAt = '2026-11-15T09:30:00.000Z'): FactoryRun =>
  ({ id, ticketId: 't1', machineId: 'dev', machineName, executor: 'agent', status, outcome: status === 'completed' ? 'done' : null, executionId, error: null, startedAt, finishedAt: status === 'running' ? null : '2026-11-15T09:35:00.000Z' });
const runsAre = (rows: FactoryRun[]) => vi.mocked(factoryApi.runs).mockResolvedValue(rows);
const running = (runId: string) => ({ ...ticket('dev', 'running'), runId });
const streamShows = async (id: string) => waitFor(() => expect(screen.getByTestId('stream').getAttribute('data-execution-id')).toBe(id));
/* the card stays visibility:hidden until the floor places it, so the tabs have no accessible name in jsdom: match their text */
const tab = (name: RegExp) => { const t = screen.getAllByRole('tab', { hidden: true }).find((b) => name.test(b.textContent ?? '')); if (!t) throw new Error(`no tab ${name}`); return t; };

describe('<FactoryPeek/> Thread · Run', () => {
  it('opens a ticket a station is running straight on its live log: that is what one clicks a running ticket for', async () => {
    runsAre([runRow('r1', 'e1', 'running')]);
    seed(running('r1'));
    open();
    await streamShows('e1');
    expect(tab(/Run/).getAttribute('aria-selected')).toBe('true');
  });

  it('opens a ticket waiting at a gate on its thread, where the decision is made; its last run is one click away', async () => {
    /* as the engine leaves it: the agent's run done, then the gate's own run, with no execution, as the ticket's run */
    runsAre([runRow('r1', 'e1', 'completed'), { ...runRow('g1', null, 'needs_review', 'Check spec', '2026-11-15T09:40:00.000Z'), machineId: 'qa', executor: 'human_gate' }]);
    seed({ ...ticket('qa', 'review'), runId: 'g1' });
    open();
    await waitFor(() => expect(screen.getByRole('tablist', { hidden: true })).toBeTruthy());
    expect(tab(/Thread/).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('approve')).toBeTruthy();
    expect(screen.queryByTestId('stream')).toBeNull();
    fireEvent.click(tab(/Run/));
    await streamShows('e1');
  });

  it('shows no switch at all for a ticket that never ran: the card stays as it was', async () => {
    seed(ticket('dev', 'question'));
    open();
    await waitFor(() => expect(factoryApi.runs).toHaveBeenCalledWith('t1'));
    expect(screen.queryByRole('tablist', { hidden: true })).toBeNull();
    expect(screen.getByPlaceholderText(/station takes the ticket again/)).toBeTruthy();
  });

  it('a look at the log loses neither the draft nor the loaded thread', async () => {
    runsAre([runRow('r1', 'e1', 'running')]);
    seed(running('r1'));
    open();
    await streamShows('e1');
    fireEvent.click(tab(/Thread/));
    const field = screen.getByPlaceholderText(/Reply:/) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'half an answer' } });
    fireEvent.click(tab(/Run/));
    await streamShows('e1');
    fireEvent.click(tab(/Thread/));
    expect((screen.getByPlaceholderText(/Reply:/) as HTMLTextAreaElement).value).toBe('half an answer');
    expect(api.fetchTicketComments).toHaveBeenCalledTimes(1);
  });

  it('when the ticket moves on to another run, keeps the log being read and offers to follow instead', async () => {
    runsAre([runRow('r1', 'e1', 'running')]);
    seed(running('r1'));
    open();
    await streamShows('e1');

    runsAre([runRow('r1', 'e1', 'completed'), runRow('r2', 'e2', 'running', 'Deploy', '2026-11-15T09:40:00.000Z')]);
    act(() => { seed(running('r2'), '2026-11-15T10:00:03.000Z'); });
    await waitFor(() => expect(screen.getByText('Follow →')).toBeTruthy());
    expect(screen.getByTestId('stream').getAttribute('data-execution-id')).toBe('e1');
    fireEvent.click(screen.getByText('Follow →'));
    await streamShows('e2');
    expect(screen.queryByText('Follow →')).toBeNull();
  });

  it('says the run is starting until the runner gives its execution id, then shows the log', async () => {
    runsAre([runRow('r1', null, 'running')]);
    seed(running('r1'));
    open();
    await waitFor(() => expect(screen.getByText('Starting…')).toBeTruthy());
    expect(screen.queryByTestId('stream')).toBeNull();

    runsAre([runRow('r1', 'e1', 'running')]);
    act(() => { seed(running('r1'), '2026-11-15T10:00:03.000Z'); });
    await streamShows('e1');
  });

  it('lists every run with a log in the picker; picking one shows its log', async () => {
    runsAre([runRow('r0', 'e0', 'completed', 'Spec', '2026-11-15T09:00:00.000Z'), runRow('r1', 'e1', 'running')]);
    seed(running('r1'));
    open();
    await streamShows('e1');
    fireEvent.click(screen.getByText(/run 2\/2/));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Spec/, hidden: true }));
    await streamShows('e0');
    /* the ticket did not move: nothing to follow, only an older run being read */
    expect(screen.queryByText('Follow →')).toBeNull();
  });

  it('Escape with the run picker open closes the picker, not the card under it', async () => {
    runsAre([runRow('r0', 'e0', 'completed', 'Spec', '2026-11-15T09:00:00.000Z'), runRow('r1', 'e1', 'running')]);
    seed(running('r1'));
    open();
    await streamShows('e1');
    /* the floor closes the card from a keydown on window, as FactoryPage does */
    const floor = vi.fn();
    window.addEventListener('keydown', floor);
    try {
      fireEvent.click(screen.getByText(/run 2\/2/));
      await screen.findByRole('menuitem', { name: /Spec/, hidden: true });
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menuitem', { name: /Spec/, hidden: true })).toBeNull());
      expect(floor).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', floor); }
  });

  it('stops a live run in two clicks, and pops its log out into the floating panel', async () => {
    runsAre([runRow('r1', 'e1', 'running')]);
    seed(running('r1'));
    const on = openWithPopOut();
    await streamShows('e1');
    fireEvent.click(screen.getByText('Stop'));
    expect(api.cancelExecution).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByText('Confirm stop?')); });
    expect(api.cancelExecution).toHaveBeenCalledWith('e1');

    fireEvent.click(screen.getByText('⤢ Pop out'));
    expect(on.onPopOut).toHaveBeenCalledWith('e1', 'Dev · execution log');
    expect(on.onClose).toHaveBeenCalled();
  });
});

const exec = (id: string, status: AgentExecution['status'], startedAt: string, model = 'sonnet'): AgentExecution =>
  ({ id, personaId: 'p1', ticketId: 't1', mentionId: 'm1', eventCount: 3, status, startedAt, completedAt: status === 'running' ? null : startedAt, lastEventAt: null, model, costUsd: 0.4 });
const comment = (id: string, body: string, createdAt: string): TicketComment =>
  ({ id, ticketId: 't1', authorType: 'agent', authorName: 'Factory → Build', body, visibility: 'public', privateRecipients: [], mentions: [], parentId: null, createdAt, updatedAt: createdAt });

describe('<FactoryPeek/> runs in the thread', () => {
  /* the conversation reads as on the Work screen: what ran sits among what was said, where it started */
  it('shows each run as a card in the thread, between the messages around it', async () => {
    vi.mocked(api.fetchTicketComments).mockResolvedValue([comment('c1', 'spec ready', '2026-11-15T09:00:00.000Z'), comment('c2', 'PR opened', '2026-11-15T09:40:00.000Z')]);
    vi.mocked(api.fetchExecutionsForTicket).mockResolvedValue([exec('e1', 'completed', '2026-11-15T09:30:00.000Z')]);
    seed(ticket('dev', 'question'));
    open();
    const card = await screen.findByTitle('Open execution log');
    const spec = screen.getByText('spec ready'), pr = screen.getByText('PR opened');
    expect(spec.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(pr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a station's run card opens its log in the Run tab, not elsewhere", async () => {
    runsAre([runRow('r0', 'e0', 'completed', 'Spec', '2026-11-15T09:00:00.000Z'), runRow('r1', 'e1', 'completed')]);
    vi.mocked(api.fetchExecutionsForTicket).mockResolvedValue([exec('e0', 'completed', '2026-11-15T09:00:00.000Z'), exec('e1', 'completed', '2026-11-15T09:30:00.000Z')]);
    seed({ ...ticket('dev', 'question'), runId: 'r1' });
    const on = openWithPopOut();
    await waitFor(() => expect(screen.getAllByTitle('Open execution log')).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('tablist', { hidden: true })).toBeTruthy());
    fireEvent.click(screen.getAllByTitle('Open execution log')[0]!);
    await streamShows('e0');
    expect(tab(/Run/).getAttribute('aria-selected')).toBe('true');
    expect(on.onPopOut).not.toHaveBeenCalled();
  });

  it('a run no station started has no Run tab to show it in: its card pops the log out', async () => {
    vi.mocked(api.fetchExecutionsForTicket).mockResolvedValue([exec('e9', 'completed', '2026-11-15T09:30:00.000Z', 'opus')]);
    seed(ticket('dev', 'question'));
    const on = openWithPopOut();
    fireEvent.click(await screen.findByTitle('Open execution log'));
    expect(on.onPopOut).toHaveBeenCalledWith('e9', 'opus · execution log');
    expect(on.onClose).toHaveBeenCalled();
  });
});
