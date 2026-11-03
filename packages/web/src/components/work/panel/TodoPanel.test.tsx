/**
 * The Todo tool window — what the human relies on during QA: see what is left,
 * check / reopen an item, know who did what, and never lose an agent's item by
 * a stray click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import type { TicketTodoItem } from '@fleex/shared';

const api = vi.hoisted(() => ({
  fetchTicketTodos: vi.fn(),
  createTicketTodo: vi.fn(),
  updateTicketTodo: vi.fn(),
  deleteTicketTodo: vi.fn(),
  fetchTicketTodoEvents: vi.fn(),
  fetchPersonas: vi.fn(),
}));
vi.mock('../../../services/api', () => api);

const ws = vi.hoisted(() => ({ handler: null as ((msg: { type: string; data: unknown }) => void) | null }));
vi.mock('../../../services/websocket', () => ({
  appWs: { onChannel: (_c: string, h: (msg: { type: string; data: unknown }) => void) => { ws.handler = h; return () => {}; } },
}));

const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/toast', () => ({ toast: { info: toastInfo, error: vi.fn(), success: vi.fn() } }));

import { TodoPanel, pastedItems } from './TodoPanel';
import { delegatedToHumanCount, openTodoCount, useTodoStore } from '../../../stores/todoStore';
import { useAgentPersonaStore } from '../../../stores/agentPersonaStore';
import { useSettingsStore } from '../../../stores/settingsStore';

/** Agents see the todo (Settings): the collaborative behaviour most tests below exercise. */
const setAgentAccess = (on: boolean) =>
  useSettingsStore.setState((s) => ({ settings: { ...s.settings, todoAgentAccess: on } }));

const item = (ref: number, over: Partial<TicketTodoItem> = {}): TicketTodoItem => ({
  id: `i${ref}`, ticketId: 't1', ref, text: `Item ${ref}`, note: null, state: 'open', position: ref,
  createdByType: 'agent', createdByName: 'Catalyst', stateChangedAt: null, stateChangedByType: null, stateChangedByName: null,
  cancelReason: null, assignee: null, assignedByType: null, assignedByName: null, takeoverReason: null, createdAt: '2026-11-03T09:00:00.000Z', updatedAt: '2026-11-03T09:00:00.000Z', ...over,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  toastInfo.mockReset();
  useTodoStore.setState({ byTicket: {}, loadError: {}, flashing: {} });
  api.fetchPersonas.mockResolvedValue([
    { id: 'p1', name: 'builder', displayName: 'Builder' },
    { id: 'p2', name: 'catalyst', displayName: 'Catalyst' },
  ]);
  useAgentPersonaStore.setState({ personas: [], loaded: false });
  setAgentAccess(true);
});
afterEach(cleanup);

/** Item actions live in the row's "⋯" menu. */
function openMenuItem(ref: number, label: string) {
  fireEvent.click(screen.getByRole('button', { name: `Actions de #${ref}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
}

describe('TodoPanel', () => {
  it('invites to start a list when the ticket has none', async () => {
    api.fetchTicketTodos.mockResolvedValue([]);
    render(<TodoPanel ticketId="t1" />);
    expect(await screen.findByText(/Pas de todo sur ce ticket/)).toBeTruthy();
  });

  it('shows open items, who closed done ones, and folds cancelled ones', async () => {
    api.fetchTicketTodos.mockResolvedValue([
      item(1),
      item(2, { state: 'done', stateChangedAt: '2026-11-03T14:02:00.000Z', stateChangedByType: 'agent', stateChangedByName: 'Builder' }),
      item(3, { state: 'cancelled', stateChangedAt: '2026-11-03T15:00:00.000Z', stateChangedByType: 'user', stateChangedByName: 'nas', cancelReason: 'doublon' }),
    ]);
    render(<TodoPanel ticketId="t1" />);
    expect(await screen.findByText('Item 1')).toBeTruthy();
    expect(screen.getByText(/1 fait · 1 à faire · 1 annulé/)).toBeTruthy();
    expect(screen.getByText(/fait par/).textContent).toContain('Builder');
    // Cancelled is folded by default: the item is not rendered until unfolded.
    expect(screen.queryByText('Item 3')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Annulé \(1\)/ }));
    expect(screen.getByText('Item 3')).toBeTruthy();
    expect(screen.getByText(/« doublon »/)).toBeTruthy();
  });

  it('checks an item at once (optimistic) and offers Undo', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1)]);
    api.updateTicketTodo.mockResolvedValue({ item: item(1, { state: 'done', stateChangedByName: 'nas', stateChangedByType: 'user', stateChangedAt: '2026-11-03T10:00:00.000Z' }), history: [{}] });
    render(<TodoPanel ticketId="t1" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Marquer #1 fait' }));
    expect(api.updateTicketTodo).toHaveBeenCalledWith('t1', 'i1', { state: 'done' });
    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith('#1 fait', expect.objectContaining({ action: expect.anything() })));
    // Undo puts it back to its previous state.
    api.updateTicketTodo.mockResolvedValue({ item: item(1), history: [{}] });
    toastInfo.mock.calls[0]![1].action.onClick();
    expect(api.updateTicketTodo).toHaveBeenLastCalledWith('t1', 'i1', { state: 'open' });
  });

  it('adds an item on Enter and keeps the focus to chain entries', async () => {
    api.fetchTicketTodos.mockResolvedValue([]);
    api.createTicketTodo.mockResolvedValue({ item: item(1, { text: 'Nouveau', createdByType: 'user', createdByName: 'nas' }), history: [{}] });
    render(<TodoPanel ticketId="t1" />);
    const input = await screen.findByRole('textbox', { name: 'Ajouter un item à la todo' });
    fireEvent.change(input, { target: { value: 'Nouveau' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Yours by default (decision: an item the human notes is the human's).
    await waitFor(() => expect(api.createTicketTodo).toHaveBeenCalledWith('t1', { text: 'Nouveau', assignee: { type: 'user', name: null } }));
    expect(await screen.findByText('Nouveau')).toBeTruthy();
  });

  it('asks before deleting an item an agent created', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1)]);
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 1');
    openMenuItem(1, 'Supprimer');
    expect(await screen.findByText(/a été créé par/)).toBeTruthy();
    expect(api.deleteTicketTodo).not.toHaveBeenCalled();
  });

  // Review finding: a delete sent only when the toast closed was lost on reload.
  it('deletes your own item on the server at once, and Undo restores it', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1, { createdByType: 'user', createdByName: 'nas' })]);
    api.deleteTicketTodo.mockResolvedValue({ item: item(1), history: [{}] });
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 1');
    openMenuItem(1, 'Supprimer');
    expect(screen.queryByText('Item 1')).toBeNull();
    expect(api.deleteTicketTodo).toHaveBeenCalledWith('t1', 'i1');
    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith('#1 supprimé', expect.anything()));
    api.updateTicketTodo.mockResolvedValue({ item: item(1), history: [{}] });
    await act(async () => toastInfo.mock.calls[0]![1].action.onClick());
    expect(api.updateTicketTodo).toHaveBeenCalledWith('t1', 'i1', { deleted: false });
    expect(screen.getByText('Item 1')).toBeTruthy();
  });

  // Review finding: an agent touching an item while its delete was pending brought it back.
  it('ignores live updates of an item being deleted', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1, { createdByType: 'user', createdByName: 'nas' })]);
    let finish!: (v: unknown) => void;
    api.deleteTicketTodo.mockReturnValue(new Promise((r) => { finish = r; }));
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 1');
    openMenuItem(1, 'Supprimer');
    act(() => ws.handler!({ type: 'todo:updated', data: item(1, { state: 'done' }) }));
    expect(screen.queryByText('Item 1')).toBeNull();
    await act(async () => finish({ item: item(1), history: [{}] }));
  });

  // Review finding: undoing "reopen" on a cancelled item lost its reason.
  it('Undo of a reopen puts the item back to cancelled with its reason', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1, { state: 'cancelled', cancelReason: 'doublon', stateChangedByName: 'nas', stateChangedByType: 'user', stateChangedAt: '2026-11-03T10:00:00.000Z' })]);
    api.updateTicketTodo.mockResolvedValue({ item: item(1), history: [{}] });
    render(<TodoPanel ticketId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Annulé \(1\)/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Rouvrir #1' }));
    await waitFor(() => expect(toastInfo).toHaveBeenCalled());
    toastInfo.mock.calls[0]![1].action.onClick();
    expect(api.updateTicketTodo).toHaveBeenLastCalledWith('t1', 'i1', { state: 'cancelled', reason: 'doublon' });
  });

  it('follows an agent checking an item from its CLI, live', async () => {
    // #7: an item this tab never wrote, so its WS echo is someone else's change.
    api.fetchTicketTodos.mockResolvedValue([item(7)]);
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 7');
    act(() => ws.handler!({
      type: 'todo:updated',
      data: item(7, { state: 'done', stateChangedByType: 'agent', stateChangedByName: 'Builder', stateChangedAt: '2026-11-03T14:02:00.000Z' }),
    }));
    expect(screen.getByRole('checkbox', { name: 'Repasser #7 à faire' })).toBeTruthy();
    expect(useTodoStore.getState().flashing.i7).toBe(true);
    expect(openTodoCount(useTodoStore.getState().byTicket.t1)).toBe(0);
  });

  it('shows who changed what in the history view', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1)]);
    api.fetchTicketTodoEvents.mockResolvedValue([{
      id: 'e1', itemId: 'i1', ticketId: 't1', itemRef: 1, itemText: 'Item 1', action: 'state_changed',
      changes: { state: { from: 'open', to: 'done' } }, actorType: 'agent', actorName: 'Builder', source: 'mcp', createdAt: '2026-11-03T14:02:00.000Z',
    }]);
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Historique' }));
    expect(await screen.findByText('mcp')).toBeTruthy();
    expect(screen.getByText('Builder')).toBeTruthy();
    expect(screen.getByText('Fait')).toBeTruthy();
  });
});

describe('TodoPanel — row layout (nas: no hover icons pushing the text, no emoji)', () => {
  it('keeps the actions in a "⋯" menu right of the assignee, not as buttons in the row', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1, { note: 'détail' })]);
    render(<TodoPanel ticketId="t1" />);
    const row = await screen.findByTestId('todo-row-1');
    const buttons = [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    // Checkbox, note indicator, avatar, menu — always rendered, so hover changes no width.
    expect(buttons).toEqual(['Marquer #1 fait', 'Voir la note', "#1 — Pour n'importe qui (changer)", 'Actions de #1']);
    fireEvent.click(screen.getByRole('button', { name: 'Actions de #1' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Marquer fait', 'Modifier le texte', 'Modifier la note', "Annuler l'item…", "Historique de l'item", 'Supprimer',
    ]);
  });

  it('draws its icons in SVG: no emoji or pictographic glyph in the panel', async () => {
    api.fetchTicketTodos.mockResolvedValue([
      item(1, { note: 'n' }),
      item(2, { state: 'done', stateChangedByName: 'nas', stateChangedByType: 'user', stateChangedAt: '2026-11-03T10:00:00.000Z' }),
    ]);
    const { container } = render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Actions de #1' }));
    const text = container.textContent + document.body.textContent;
    expect(text).not.toMatch(/[\u2190-\u21FF\u22EE\u22EF\u2300-\u27FF\u2B00-\u2BFF\u{1F300}-\u{1FAFF}]/u);
  });
});

describe('TodoPanel — note from the "⋯" menu (nas: « Ajouter une note » did nothing)', () => {
  it('opens the note editor and keeps it open once the menu has closed', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1)]);
    api.updateTicketTodo.mockResolvedValue({ item: item(1, { note: 'Chrome only' }), history: [{}] });
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Actions de #1' }));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Ajouter une note' })));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const editor = screen.getByRole('textbox', { name: 'Note de #1' });
    expect(document.activeElement).toBe(editor);
    fireEvent.change(editor, { target: { value: 'Chrome only' } });
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    expect(api.updateTicketTodo).toHaveBeenCalledWith('t1', 'i1', { note: 'Chrome only' });
  });

  it('opens the text editor the same way', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1)]);
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Actions de #1' }));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Modifier le texte' })));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Texte de #1' }));
  });
});

describe('TodoPanel — note view (nas: a discreet aside, not an input-looking box)', () => {
  it('renders the note as small muted italics with a hairline, no boxed surface, in theme colours only', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1, { note: 'Vérifier aussi le contexte injecté' })]);
    render(<TodoPanel ticketId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Voir la note' }));
    const note = screen.getByTestId('todo-note-1');
    expect(note.textContent).toContain('Vérifier aussi le contexte injecté');
    const cls = note.className;
    // No field look: no surface background, no rounded box.
    expect(cls).not.toMatch(/bg-|rounded|border-y|border-r|(^|\s)border(\s|$)/);
    expect(cls).toMatch(/border-l /);
    // Smaller than the item, italic, muted — and only theme variables (dark/light).
    expect(cls).toMatch(/italic/);
    expect(cls).toMatch(/text-\[11\.5px\]/);
    expect(cls).toMatch(/\[&_p\]:text-\[var\(--theme-text-muted\)\]/);
    expect(cls).not.toMatch(/(^|\s)text-(gray|zinc|slate|neutral)-/);
  });
});

describe('TodoPanel — assignment', () => {
  it('shows who each item is for, and reassigns from the avatar', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1, { assignee: { type: 'user', name: 'nas' } }), item(2)]);
    api.updateTicketTodo.mockResolvedValue({ item: item(2, { assignee: { type: 'agent', name: 'builder' } }), history: [{}] });
    render(<TodoPanel ticketId="t1" />);
    expect(await screen.findByRole('button', { name: '#1 — Assigné à nas (changer)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "#2 — Pour n'importe qui (changer)" }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Builder' }));
    expect(api.updateTicketTodo).toHaveBeenCalledWith('t1', 'i2', { assignee: { type: 'agent', name: 'builder' } });
    expect(await screen.findByRole('button', { name: '#2 — Assigné à Builder (changer)' })).toBeTruthy();
  });

  it('keeps the chosen assignee for the next items while the panel stays open, back to "me" when reopened', async () => {
    api.fetchTicketTodos.mockResolvedValue([]);
    api.createTicketTodo.mockResolvedValue({ item: item(1), history: [{}] });
    const { unmount } = render(<TodoPanel ticketId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nouveaux items — Assigné à vous (changer)' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Builder' }));
    const input = screen.getByRole('textbox', { name: 'Ajouter un item à la todo' });
    for (const text of ['Un', 'Deux']) {
      fireEvent.change(input, { target: { value: text } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(api.createTicketTodo).toHaveBeenCalledWith('t1', { text, assignee: { type: 'agent', name: 'builder' } }));
    }
    unmount();
    render(<TodoPanel ticketId="t1" />);
    expect(await screen.findByRole('button', { name: 'Nouveaux items — Assigné à vous (changer)' })).toBeTruthy();
  });

  it('cannot reassign a closed item', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1, { state: 'done', stateChangedByName: 'nas', stateChangedByType: 'user', stateChangedAt: '2026-11-03T10:00:00.000Z' })]);
    render(<TodoPanel ticketId="t1" />);
    expect(await screen.findByRole('img', { name: "#1 — Pour n'importe qui" })).toBeTruthy();
  });

  it('says plainly when an agent took over your item, and why', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1, {
      assignee: { type: 'agent', name: 'builder' }, assignedByType: 'agent', assignedByName: 'Builder', takeoverReason: 'nas: finis la QA',
    })]);
    render(<TodoPanel ticketId="t1" />);
    expect((await screen.findByText(/repris par/)).textContent).toContain('Builder');
    expect(screen.getByText('« nas: finis la QA »')).toBeTruthy();
  });

  it('"Pour moi" shows only your items', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1, { assignee: { type: 'user', name: 'nas' } }), item(2)]);
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 2');
    fireEvent.click(screen.getByRole('button', { name: 'Pour moi' }));
    expect(screen.getByText('Item 1')).toBeTruthy();
    expect(screen.queryByText('Item 2')).toBeNull();
  });

  it('counts for the ToolStrip dot only open items an agent handed to you', () => {
    expect(delegatedToHumanCount([
      item(1, { assignee: { type: 'user', name: 'nas' }, assignedByType: 'agent' }),
      item(2, { assignee: { type: 'user', name: 'nas' }, assignedByType: 'user' }), // you noted it yourself
      item(3, { assignee: { type: 'user', name: 'nas' }, assignedByType: 'agent', state: 'done' }),
    ])).toBe(1);
  });
});

describe('pastedItems', () => {
  it('turns a pasted checklist into one item per line', () => {
    expect(pastedItems('- [ ] Un\n\n2. Deux\n* Trois')).toEqual(['Un', 'Deux', 'Trois']);
  });
});

describe('TodoPanel — opened from the Timeline (a mark of the todo strip)', () => {
  it('unfolds the section of a closed item and flashes it', async () => {
    const { useWorkStore } = await import('../../../stores/workStore');
    api.fetchTicketTodos.mockResolvedValue([
      item(1),
      item(2, { state: 'cancelled', stateChangedByName: 'Builder', stateChangedByType: 'agent', stateChangedAt: '2026-11-03T10:00:00.000Z' }),
    ]);
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 1');
    // Annulé is folded by default: #2 is not shown.
    expect(screen.queryByTestId('todo-row-2')).toBeNull();
    act(() => useWorkStore.getState().focusTodo({ itemId: 'i2', view: 'list' }));
    expect(await screen.findByTestId('todo-row-2')).toBeTruthy();
    expect(useTodoStore.getState().flashing.i2).toBe(true);
    // Consumed: reopening the panel later does not replay it.
    expect(useWorkStore.getState().todoFocus).toBeNull();
  });

  it('opens the History when asked', async () => {
    const { useWorkStore } = await import('../../../stores/workStore');
    api.fetchTicketTodos.mockResolvedValue([item(1)]);
    api.fetchTicketTodoEvents.mockResolvedValue([]);
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 1');
    act(() => useWorkStore.getState().focusTodo({ itemId: null, view: 'history' }));
    await waitFor(() => expect(api.fetchTicketTodoEvents).toHaveBeenCalledWith('t1', undefined));
  });
});

describe('TodoPanel — todo access off for agents (Settings, the default)', () => {
  beforeEach(() => setAgentAccess(false));

  it('says agents do not see this list, with a way to the setting', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1)]);
    render(<TodoPanel ticketId="t1" />);
    const notice = await screen.findByTestId('todo-agents-off');
    expect(notice.textContent).toContain('Les agents ne voient pas cette todo');
    expect(screen.getByRole('button', { name: 'Réglages' })).toBeTruthy();
  });

  it('greys the agent choices of the picker: nobody would read an item given to an agent', async () => {
    api.fetchTicketTodos.mockResolvedValue([item(1)]);
    render(<TodoPanel ticketId="t1" />);
    fireEvent.click(await screen.findByRole('button', { name: "#1 — Pour n'importe qui (changer)" }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Builder' })).toBeTruthy());
    expect((screen.getByRole('menuitem', { name: 'Builder' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('menuitem', { name: "N'importe quel agent" }) as HTMLButtonElement).disabled).toBe(true);
    // Still yours to assign to yourself or to nobody.
    expect((screen.getByRole('menuitem', { name: 'Moi' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('menuitem', { name: "N'importe qui" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows no notice once agents see the todo', async () => {
    setAgentAccess(true);
    api.fetchTicketTodos.mockResolvedValue([item(1)]);
    render(<TodoPanel ticketId="t1" />);
    await screen.findByText('Item 1');
    expect(screen.queryByTestId('todo-agents-off')).toBeNull();
  });
});
