import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { useAssistantStore, __resetAssistantSocketForTests } from './assistantStore';
import { useSettingsStore } from './settingsStore';

// Minimal WebSocket stand-in: records what the store sends, and reports OPEN so
// sendMsg() actually pushes frames. onopen is never auto-fired, so the
// connect() workspace fetch stays inert (no network) for these tests.
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static last: FakeWebSocket | null = null;
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWebSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

function sentMessages(): Array<Record<string, unknown>> {
  return (FakeWebSocket.last?.sent ?? []).map((m) => JSON.parse(m));
}

describe('assistantStore.newSession — workspace pinning', () => {
  beforeEach(() => {
    FakeWebSocket.last = null;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    __resetAssistantSocketForTests();
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, workspace: '' } }));
  });

  afterEach(() => {
    __resetAssistantSocketForTests();
    vi.unstubAllGlobals();
  });

  it('pins the current app workspace when the caller passes none', () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, workspace: 'team-y' } }));
    useAssistantStore.getState().ensureConnected();

    useAssistantStore.getState().newSession();

    expect(sentMessages()).toContainEqual({ type: 'new_session', workspace: 'team-y' });
  });

  it('lets an explicit workspace argument win over the app default', () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, workspace: 'team-y' } }));
    useAssistantStore.getState().ensureConnected();

    useAssistantStore.getState().newSession('team-x');

    expect(sentMessages()).toContainEqual({ type: 'new_session', workspace: 'team-x' });
  });

  it('omits workspace when none is known so the server can fall back to its default', () => {
    useAssistantStore.getState().ensureConnected();

    useAssistantStore.getState().newSession();

    expect(sentMessages()).toContainEqual({ type: 'new_session' });
  });
});

describe('assistantStore — auto-approval', () => {
  beforeEach(() => {
    FakeWebSocket.last = null;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    __resetAssistantSocketForTests();
    useAssistantStore.setState({ confirmReqs: [], itemsBySession: {}, autoApproveNotice: null });
  });

  afterEach(() => {
    __resetAssistantSocketForTests();
    vi.unstubAllGlobals();
  });

  function receive(msg: Record<string, unknown>): void {
    FakeWebSocket.last?.onmessage?.({ data: JSON.stringify(msg) });
  }

  it('sends the always-scope alongside the approval', () => {
    useAssistantStore.getState().ensureConnected();
    receive({
      type: 'confirm_request',
      sessionId: 's1',
      id: 'c1',
      name: 'fleex_ticket_create',
      argv: ['ticket', 'create'],
    });

    useAssistantStore.getState().answerConfirm('c1', true, 'tool');

    expect(sentMessages()).toContainEqual({
      type: 'confirm',
      id: 'c1',
      approved: true,
      always: 'tool',
    });
    expect(useAssistantStore.getState().confirmReqs).toHaveLength(0);
  });

  it('omits the scope on a plain one-shot approval', () => {
    useAssistantStore.getState().ensureConnected();
    receive({
      type: 'confirm_request',
      sessionId: 's1',
      id: 'c1',
      name: 'fleex_ticket_create',
      argv: [],
    });

    useAssistantStore.getState().answerConfirm('c1', true);

    expect(sentMessages()).toContainEqual({ type: 'confirm', id: 'c1', approved: true });
  });

  it('sends a full replacement when the conversation toggle changes', () => {
    useAssistantStore.getState().ensureConnected();

    useAssistantStore.getState().setAutoApprove('s1', { all: true, tools: [] });

    expect(sentMessages()).toContainEqual({
      type: 'set_auto_approve',
      id: 's1',
      all: true,
      tools: [],
    });
  });

  it('marks auto-approved tool calls so the transcript stays auditable', () => {
    useAssistantStore.getState().ensureConnected();

    receive({
      type: 'tool_call',
      sessionId: 's1',
      id: 't1',
      name: 'fleex_ticket_create',
      argv: ['ticket', 'create'],
      autoApproved: true,
    });
    receive({
      type: 'tool_call',
      sessionId: 's1',
      id: 't2',
      name: 'fleex_ticket_delete',
      argv: ['ticket', 'delete'],
    });

    const items = useAssistantStore.getState().itemsBySession['s1']!;
    expect(items.map((i) => i.kind === 'tool' && i.autoApproved)).toEqual([true, false]);
  });

  it('keeps the auto-approved marker when a session is reloaded', () => {
    useAssistantStore.getState().ensureConnected();

    receive({
      type: 'session_history',
      id: 's1',
      transcript: [
        {
          tool: {
            name: 'fleex_ticket_create',
            argv: ['ticket', 'create'],
            status: 'ok',
            autoApproved: true,
          },
        },
      ],
    });

    const items = useAssistantStore.getState().itemsBySession['s1']!;
    expect(items[0]!.kind === 'tool' && items[0]!.autoApproved).toBe(true);
  });

  it('surfaces a dismissible notice when the server disarms auto-approval', () => {
    useAssistantStore.getState().ensureConnected();

    receive({ type: 'auto_approve_disarmed', sessionId: 's1', reason: 'page_attached' });
    expect(useAssistantStore.getState().autoApproveNotice).toContain('page web');

    useAssistantStore.getState().clearAutoApproveNotice();
    expect(useAssistantStore.getState().autoApproveNotice).toBeNull();
  });
});
