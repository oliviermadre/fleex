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
