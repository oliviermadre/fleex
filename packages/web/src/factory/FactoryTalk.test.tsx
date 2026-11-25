import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetToasts, useToastStore } from '../stores/toastStore';

const post = vi.fn(async () => ({}));
vi.mock('../services/api', () => ({ postTicketComment: (...a: unknown[]) => post(...(a as [])) }));
let wsHandler: ((msg: { type: string; data: unknown }) => void) | null = null;
vi.mock('../services/websocket', () => ({ appWs: { onChannel: (_c: string, h: typeof wsHandler) => { wsHandler = h; return () => { wsHandler = null; }; } } }));

/* a small assistant: a new conversation gets an id, a question gets an answer, the conversation goes idle again */
const asked = vi.hoisted(() => [] as string[]);
vi.mock('../stores/assistantStore', async () => {
  const { create } = await import('zustand');
  interface S { sessions: { id: string; status: string }[]; activeId: string | null; itemsBySession: Record<string, { kind: string; text: string }[]>; [k: string]: unknown }
  const fake = create<S>((set, get) => ({
    sessions: [], activeId: null, itemsBySession: {},
    ensureConnected: () => {}, renameSession: () => {}, openSession: (id: string) => set({ activeId: id }),
    newSession: () => setTimeout(() => set((s) => ({ activeId: 'fs1', sessions: [...s.sessions, { id: 'fs1', status: 'idle' }], itemsBySession: { ...s.itemsBySession, fs1: [] } })), 0),
    sendUser: (text: string) => {
      const id = get().activeId!; asked.push(text);
      set((s) => ({ itemsBySession: { ...s.itemsBySession, [id]: [...(s.itemsBySession[id] ?? []), { kind: 'user', text }] }, sessions: s.sessions.map((x) => (x.id === id ? { ...x, status: 'working' } : x)) }));
      setTimeout(() => set((s) => ({ itemsBySession: { ...s.itemsBySession, [id]: [...s.itemsBySession[id]!, { kind: 'assistant', text: 'It waits for your answer.' }] }, sessions: s.sessions.map((x) => (x.id === id ? { ...x, status: 'idle' } : x)) })), 0);
    },
  }));
  return { useAssistantStore: fake };
});

import { FactoryTalk, talkLog, talkTargets, useTalkReplies } from './FactoryTalk';

beforeEach(() => { resetToasts(); talkLog.said = []; talkLog.last = 'ticket'; talkLog.tickets.clear(); try { localStorage.clear(); } catch { /* none */ } });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const TICKET = { ticketId: 't1', label: '#788 unipile' };
const show = (ticket = TICKET) => render(<MemoryRouter><FactoryTalk ticket={ticket} onClose={vi.fn()} onOpenTicket={vi.fn()} /></MemoryRouter>);
const line = () => screen.getByRole('textbox');

describe('talking from the floor', () => {
  it('opens on the ticket selected, else on whoever was talked to last; Tab goes round', () => {
    expect(talkTargets(TICKET, 'ticket').map((t) => t.kind)).toEqual(['ticket', 'assistant']);
    expect(talkTargets(TICKET, 'assistant').map((t) => t.kind)).toEqual(['assistant', 'ticket']);
    expect(talkTargets(null, 'ticket').map((t) => t.kind)).toEqual(['assistant']);
    show();
    expect(screen.getByTestId('talk-target').textContent).toContain('[#788 unipile]');
    fireEvent.keyDown(line(), { key: 'Tab' });
    expect(screen.getByTestId('talk-target').textContent).toContain('[Assistant]');
  });

  it('to a ticket: a comment in its thread, kept in the log; its agents\' replies come back as messages', () => {
    show();
    fireEvent.change(line(), { target: { value: 'Use the staging key' } });
    fireEvent.keyDown(line(), { key: 'Enter' });
    expect(post).toHaveBeenCalledWith('t1', 'Use the staging key');
    expect(screen.getByRole('dialog', { name: 'Talk' }).textContent).toContain('To #788 unipile');
    cleanup();
    function Replies() { useTalkReplies(vi.fn()); return null; }
    render(<Replies />);
    act(() => wsHandler!({ type: 'comment:created', data: { ticketId: 't1', authorType: 'agent', authorName: 'Odys AI', body: 'Thanks, I run again.' } }));
    act(() => wsHandler!({ type: 'comment:created', data: { ticketId: 'other', authorType: 'agent', authorName: 'X', body: 'not for us' } }));
    expect(useToastStore.getState().history.map((h) => `${h.title} ${h.message}`)).toEqual(['[#788 unipile] Odys AI Thanks, I run again.']);
  });

  it('to the assistant: its own conversation, told once where it is, and the answer back as a message', async () => {
    vi.useFakeTimers();
    show(null as never);
    fireEvent.change(line(), { target: { value: 'why is #788 stuck?' } });
    fireEvent.keyDown(line(), { key: 'Enter' });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(asked[0]).toMatch(/^I am on the Factory floor of Fleex.*why is #788 stuck\?$/s);
    expect(localStorage.getItem('fleex.factory.assistantSession')).toBe('fs1');
    expect(useToastStore.getState().history.at(-1)).toMatchObject({ title: '[Assistant]', message: 'It waits for your answer.' });
    vi.useRealTimers();
  });
});
