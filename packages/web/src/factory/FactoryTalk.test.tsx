import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetToasts, useToastStore } from '../stores/toastStore';

const post = vi.fn(async () => ({}));
const comments = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('../services/api', () => ({ postTicketComment: (...a: unknown[]) => post(...(a as [])), fetchTicketComments: async () => comments.list }));
const retry = vi.hoisted(() => ({ fn: (() => {}) as (id: string) => void }));
vi.mock('./factoryStore', () => ({ useFactoryStore: { getState: () => ({ retry: (id: string) => { retry.fn(id); return Promise.resolve(); }, setAside: async () => {}, release: async () => {}, star: async () => {}, giveBack: async () => {} }) } }));
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

import { renderHook } from '@testing-library/react';
import { announceTicket, FactoryTalk, talkLog, talkTargets, useTalkReplies, useTicketVoices } from './FactoryTalk';

beforeEach(() => { resetToasts(); talkLog.said = []; talkLog.last = 'ticket'; talkLog.tickets.clear(); talkLog.announced.clear(); talkLog.lastSpoke = null; comments.list = []; try { localStorage.clear(); } catch { /* none */ } });
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

  it('a ticket set aside on a question writes its question, its choices answer it; once per set-aside', async () => {
    comments.list = [
      { authorType: 'user', body: 'go' },
      { authorType: 'agent', body: 'Which API key should I use?', questions: [{ prompt: 'Key', options: ['staging', 'prod'] }] },
    ];
    const t = { ticketId: 't1', label: '#788 unipile', station: 'Spec', phase: 'question' as const };
    await act(async () => { await announceTicket(t, vi.fn(), 's1'); await announceTicket(t, vi.fn(), 's1'); });
    const h = useToastStore.getState().history;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ title: 'From #788 unipile · Spec', message: 'Which API key should I use?' });
    expect(h[0]!.choices!.map((c) => c.label)).toEqual(['staging', 'prod']);
    expect(talkLog.lastSpoke?.ticketId).toBe('t1');
    h[0]!.choices![1]!.onClick();
    expect(post).toHaveBeenCalledWith('t1', 'prod');
    expect(talkLog.said.at(-1)).toMatchObject({ to: '#788 unipile', text: 'prod' });
  });

  it('a failed run writes too, with Run again; a gate or a ticket set aside by hand says nothing', async () => {
    const seen: string[] = []; retry.fn = (id) => seen.push(id);
    await act(async () => {
      await announceTicket({ ticketId: 't2', label: '#790', station: 'Build', phase: 'failed', note: 'exit 1 in pnpm test' }, vi.fn(), 's');
      await announceTicket({ ticketId: 't3', label: '#792', phase: 'review' }, vi.fn(), 's');
      await announceTicket({ ticketId: 't4', label: '#793', phase: 'aside' }, vi.fn(), 's');
    });
    const h = useToastStore.getState().history;
    expect(h.map((x) => x.message)).toEqual(['The run failed: exit 1 in pnpm test']);
    h[0]!.choices![0]!.onClick();
    expect(seen).toEqual(['t2']);
  });

  it('speaks up when a ticket is set aside while the page is open, not for what waited before', async () => {
    const describe = (id: string) => ({ ticketId: id, label: `#${id}` });
    const at = (phase: string) => [{ ticketId: 'a', phase, since: phase, note: '' }, { ticketId: 'b', phase: 'question', since: 'x', note: '' }] as never;
    const { rerender } = renderHook(({ list }) => useTicketVoices(list, describe, vi.fn()), { initialProps: { list: at('running') } });
    await act(async () => { rerender({ list: at('question') }); await Promise.resolve(); });
    expect(useToastStore.getState().history.map((x) => x.title)).toEqual(['From #a']);
  });

  it('opened on a ticket that waited on a question, the line puts its question in the log first', async () => {
    comments.list = [{ authorType: 'agent', body: 'Which key?' }];
    show({ ...TICKET, phase: 'question' } as never);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(useToastStore.getState().history.map((x) => x.message)).toEqual(['Which key?']);
    expect(line().getAttribute('placeholder')).toBe('Answer its question: its station runs again');
  });

  it('a slash lists the commands for whoever the line talks to; Enter runs one, and the log says so', async () => {
    const seen: string[] = []; retry.fn = (id) => seen.push(id);
    show({ ...TICKET, phase: 'failed' } as never);
    fireEvent.change(line(), { target: { value: '/' } });
    expect(screen.getAllByRole('option').map((o) => o.querySelector('b')!.textContent)).toEqual(['/run', '/open', '/giveback']);
    fireEvent.change(line(), { target: { value: '/r' } });
    fireEvent.keyDown(line(), { key: 'Tab' });
    expect((line() as HTMLInputElement).value).toBe('/run');
    await act(async () => { fireEvent.keyDown(line(), { key: 'Enter' }); await Promise.resolve(); await Promise.resolve(); });
    expect(seen).toEqual(['t1']);
    expect(post).not.toHaveBeenCalled();                                      // a command is no comment
    expect(screen.getByRole('dialog', { name: 'Talk' }).textContent).toContain('/run');
    expect(useToastStore.getState().history.at(-1)?.message).toBe('#788 unipile: its station runs again');
  });
});
