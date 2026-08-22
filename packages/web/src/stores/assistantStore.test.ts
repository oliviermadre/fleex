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
  /** Overridden by the outbox tests, which need a socket that is not open yet. */
  static initialState = FakeWebSocket.OPEN;
  readyState = FakeWebSocket.initialState;
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
    receive({ type: 'confirm_request', sessionId: 's1', id: 'c1', name: 'fleex_ticket_create', argv: ['ticket', 'create'] });

    useAssistantStore.getState().answerConfirm('c1', true, 'tool');

    expect(sentMessages()).toContainEqual({ type: 'confirm', id: 'c1', approved: true, always: 'tool' });
    expect(useAssistantStore.getState().confirmReqs).toHaveLength(0);
  });

  it('omits the scope on a plain one-shot approval', () => {
    useAssistantStore.getState().ensureConnected();
    receive({ type: 'confirm_request', sessionId: 's1', id: 'c1', name: 'fleex_ticket_create', argv: [] });

    useAssistantStore.getState().answerConfirm('c1', true);

    expect(sentMessages()).toContainEqual({ type: 'confirm', id: 'c1', approved: true });
  });

  it('sends a full replacement when the conversation toggle changes', () => {
    useAssistantStore.getState().ensureConnected();

    useAssistantStore.getState().setAutoApprove('s1', { all: true, tools: [] });

    expect(sentMessages()).toContainEqual({ type: 'set_auto_approve', id: 's1', all: true, tools: [] });
  });

  it('marks auto-approved tool calls so the transcript stays auditable', () => {
    useAssistantStore.getState().ensureConnected();

    receive({ type: 'tool_call', sessionId: 's1', id: 't1', name: 'fleex_ticket_create', argv: ['ticket', 'create'], autoApproved: true });
    receive({ type: 'tool_call', sessionId: 's1', id: 't2', name: 'fleex_ticket_delete', argv: ['ticket', 'delete'] });

    const items = useAssistantStore.getState().itemsBySession['s1']!;
    expect(items.map((i) => i.kind === 'tool' && i.autoApproved)).toEqual([true, false]);
  });

  it('keeps the auto-approved marker when a session is reloaded', () => {
    useAssistantStore.getState().ensureConnected();

    receive({
      type: 'session_history',
      id: 's1',
      transcript: [{ tool: { name: 'fleex_ticket_create', argv: ['ticket', 'create'], status: 'ok', autoApproved: true } }],
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

/**
 * Nothing sent to the companion is lost because the socket was not open yet.
 *
 * `sendMsg` used to drop a frame in silence when the socket was down, and the
 * only thing that opens the socket is the assistant panel itself. Ask Memory
 * lives at the app root: on a page load where that panel had never been visited,
 * every exchange it recorded went nowhere, and "Continue in Assistant" landed on
 * a conversation the server had never heard of.
 */
describe('assistantStore — the outbox', () => {
  beforeEach(() => {
    FakeWebSocket.last = null;
    FakeWebSocket.initialState = FakeWebSocket.CONNECTING;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    __resetAssistantSocketForTests();
  });

  afterEach(() => {
    FakeWebSocket.initialState = FakeWebSocket.OPEN;
    __resetAssistantSocketForTests();
    useAssistantStore.setState({ activeId: null, itemsBySession: {}, confirmReqs: [] });
    vi.unstubAllGlobals();
  });

  /** Bring the socket the store just opened up, and fire its onopen. */
  function openSocket(): void {
    const socket = FakeWebSocket.last!;
    socket.readyState = FakeWebSocket.OPEN;
    socket.onopen!();
  }

  it('opens the socket itself rather than recording into one that does not exist', () => {
    useAssistantStore.getState().recordExchange('conv-1', 'quelles routines ?', 'trois.');

    expect(FakeWebSocket.last).not.toBeNull();
  });

  it('delivers an exchange recorded before the socket finished opening', () => {
    useAssistantStore.getState().recordExchange('conv-1', 'quelles routines ?', 'trois.');
    expect(sentMessages()).toEqual([]);

    openSocket();

    expect(sentMessages()).toContainEqual({
      type: 'record_exchange',
      id: 'conv-1',
      question: 'quelles routines ?',
      answer: 'trois.',
    });
  });

  it('keeps the order, so the conversation exists before it is opened', () => {
    // open_session on an id the server has not been told about answers nothing,
    // which is exactly the empty panel this fixes.
    useAssistantStore.getState().recordExchange('conv-1', 'q', 'a');
    useAssistantStore.getState().openSession('conv-1');

    openSocket();

    const types = sentMessages().map((m) => m.type);
    expect(types.indexOf('record_exchange')).toBeLessThan(types.indexOf('open_session'));
  });

  it('does not open the same conversation twice on connect', () => {
    // The reconnect re-send and a queued open_session would both ask for the
    // history, and the second reply wipes any turn appended after the first.
    useAssistantStore.getState().openSession('conv-1');

    openSocket();

    expect(sentMessages().filter((m) => m.type === 'open_session')).toHaveLength(1);
  });

  it('still re-opens the conversation in view after a plain reconnect', () => {
    useAssistantStore.getState().ensureConnected();
    useAssistantStore.setState({ activeId: 'conv-9' });

    openSocket();

    expect(sentMessages()).toContainEqual({ type: 'open_session', id: 'conv-9' });
  });

  it('does not replay an approval answered while the socket was down', () => {
    // The server unwinds pending confirmations as denied on disconnect, so a
    // queued approval would authorise a command nobody is waiting on any more.
    useAssistantStore.getState().ensureConnected();
    useAssistantStore.setState({
      confirmReqs: [{ sessionId: 'conv-1', id: 'c1', name: 'fleex_ticket_create', argv: [] }],
    });
    useAssistantStore.getState().answerConfirm('c1', true);

    openSocket();

    expect(sentMessages().some((m) => m.type === 'confirm')).toBe(false);
  });
});

/**
 * A question typed in the Ask Memory panel and taken to the assistant.
 *
 * "Continue in Assistant" dropped it: the panel navigated, and the question had
 * to be retyped over there. It is dispatched once the recorded history has
 * landed, because `session_history` replaces this conversation's items wholesale
 * and a turn appended before it arrives is wiped.
 */
describe('assistantStore.openSession — carrying a question in', () => {
  beforeEach(() => {
    FakeWebSocket.last = null;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    __resetAssistantSocketForTests();
    useAssistantStore.getState().ensureConnected();
  });

  afterEach(() => {
    __resetAssistantSocketForTests();
    useAssistantStore.setState({ activeId: null, itemsBySession: {}, confirmReqs: [] });
    vi.unstubAllGlobals();
  });

  /** Reply to open_session the way the companion does. */
  function history(id: string, transcript: unknown[]): void {
    FakeWebSocket.last!.onmessage!({
      data: JSON.stringify({ type: 'session_history', id, transcript }),
    });
  }

  it('asks the carried question once the history has landed', () => {
    useAssistantStore.getState().openSession('conv-1', 'et le KR2.1 ?');

    expect(sentMessages().some((m) => m.type === 'user')).toBe(false);

    history('conv-1', [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }]);

    expect(sentMessages()).toContainEqual({
      type: 'user',
      sessionId: 'conv-1',
      text: 'et le KR2.1 ?',
    });
  });

  it('shows the carried question in the transcript it landed in', () => {
    useAssistantStore.getState().openSession('conv-1', 'et le KR2.1 ?');
    history('conv-1', [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }]);

    expect(useAssistantStore.getState().itemsBySession['conv-1']).toEqual([
      { kind: 'user', text: 'q' },
      { kind: 'assistant', text: 'a' },
      { kind: 'user', text: 'et le KR2.1 ?' },
    ]);
  });

  it('carries nothing when no question was handed over', () => {
    useAssistantStore.getState().openSession('conv-1');
    history('conv-1', [{ role: 'user', text: 'q' }]);

    expect(sentMessages().some((m) => m.type === 'user')).toBe(false);
  });

  it('asks it once, however many times the history is re-sent', () => {
    useAssistantStore.getState().openSession('conv-1', 'et le KR2.1 ?');
    history('conv-1', [{ role: 'user', text: 'q' }]);
    history('conv-1', [{ role: 'user', text: 'q' }]);

    expect(sentMessages().filter((m) => m.type === 'user')).toHaveLength(1);
  });

  it('does not leak a carried question into the next conversation opened', () => {
    useAssistantStore.getState().openSession('conv-1', 'et le KR2.1 ?');
    useAssistantStore.getState().openSession('conv-2');

    history('conv-2', [{ role: 'user', text: 'autre' }]);

    expect(sentMessages().some((m) => m.type === 'user')).toBe(false);
  });
});
