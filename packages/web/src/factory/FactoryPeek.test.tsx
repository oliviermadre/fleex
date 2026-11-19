/**
 * The card a click on a ticket opens beside its machine. Its fields are the composer every other Fleex field uses:
 * an answer or a gate's reason can carry markdown and a pasted screenshot, not just one line of plain text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import * as api from '../services/api';
import { FactoryPeek } from './FactoryPeek';
import { useFactoryStore } from './factoryStore';
import type { FactorySnapshot, FactoryTicket, MachineSpec, TicketPhase } from './types';

vi.mock('../services/api', async (original) => ({
  ...(await original<typeof import('../services/api')>()),
  fetchTicketComments: vi.fn(async () => []),
  postTicketComment: vi.fn(async () => ({})),
  uploadFile: vi.fn(async () => ({ originalName: 'shot.png', url: '/api/files/shot.png' })),
}));
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

function seed(t: FactoryTicket) {
  const layout = { version: 2, w: 30, h: 12, machines: [dev, gate] };
  const snapshot: FactorySnapshot = { floor: { id: 'f', name: 'Floor', layout, settings: { maxRunsPerHour: 20, maxConcurrentRuns: 3 } }, tickets: [t], arms: [], runsLastHour: 0, running: 0, serverTime: '2026-11-15T10:00:00.000Z' };
  const resolve = vi.fn(async () => {});
  useFactoryStore.setState({ enabled: true, snapshot, layout, resolve, putBack: vi.fn(async () => {}) });
  return { resolve };
}
const open = () => { const on = { onOpen: vi.fn(), onClose: vi.fn() }; render(<FactoryPeek ticketId="t1" {...on} />); return on; };
const paste = (field: HTMLElement, file: File) => fireEvent.paste(field, { clipboardData: { files: [file] } });
const shot = () => new File(['png'], 'shot.png', { type: 'image/png' });

afterEach(() => { cleanup(); });
beforeEach(() => { vi.clearAllMocks(); });

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
