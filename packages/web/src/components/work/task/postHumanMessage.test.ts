import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const api = vi.hoisted(() => ({
  postAssistantMessage: vi.fn(),
  postTicketComment: vi.fn(async () => ({ id: 'plain' })),
  updateTicketExecutionConfig: vi.fn(async () => ({})),
}));
vi.mock('../../../services/api', () => api);

import { postHumanMessage } from './postHumanMessage';
import { useModeRequestActions } from './useModeRequestActions';
import { useSettingsStore } from '../../../stores/settingsStore';

const setSwitch = (workThreadsEnabled: boolean | undefined) =>
  useSettingsStore.setState((s) => ({ settings: { ...s.settings, workThreadsEnabled } }));

beforeEach(() => {
  vi.clearAllMocks();
  api.postAssistantMessage.mockResolvedValue({ comment: { id: 'c' }, assistant: { personaId: 'p', displayName: 'Nas' } });
});

describe('postHumanMessage — the one rule of every human composer', () => {
  it('switch on: the message goes to the assistant, mention included, and no direct comment is posted', async () => {
    setSwitch(true);
    const res = await postHumanMessage('t1', '@agent:catalyst spécifie X');
    expect(api.postAssistantMessage).toHaveBeenCalledWith('t1', '@agent:catalyst spécifie X');
    expect(api.postTicketComment).not.toHaveBeenCalled();
    expect(res).toMatchObject({ viaAssistant: true, assistantMissing: false, comment: { id: 'c' } });
  });

  it('switch on, no assistant persona: falls back to a plain comment and says so', async () => {
    setSwitch(true);
    api.postAssistantMessage.mockResolvedValue({ comment: null, assistant: null });
    const res = await postHumanMessage('t1', '@agent:catalyst spécifie X');
    expect(api.postTicketComment).toHaveBeenCalledWith('t1', '@agent:catalyst spécifie X');
    expect(res).toMatchObject({ viaAssistant: false, assistantMissing: true, comment: { id: 'plain' } });
  });

  for (const off of [false, undefined]) {
    it(`switch ${off === false ? 'off' : 'never set'}: a plain comment, the assistant route is not called, re-mention choices travel with it`, async () => {
      setSwitch(off);
      const res = await postHumanMessage('t1', '@agent:dev go');
      expect(api.postAssistantMessage).not.toHaveBeenCalled();
      expect(api.postTicketComment).toHaveBeenCalledWith('t1', '@agent:dev go');
      expect(res).toMatchObject({ viaAssistant: false, assistantMissing: false });

      const conflicts = [{ agent: 'dev', action: 'new_subject' }] as never;
      await postHumanMessage('t1', '@agent:dev go', conflicts);
      expect(api.postTicketComment).toHaveBeenLastCalledWith('t1', '@agent:dev go', undefined, conflicts);
    });
  }
});

describe('useModeRequestActions — answering a mode request outside the Tasks view', () => {
  beforeEach(() => setSwitch(true));

  it('granting patches the ticket mode first, then tells the assistant', async () => {
    const { result } = renderHook(() => useModeRequestActions('t1', 'plan'));
    await act(() => result.current.grantMode({ mode: 'edit', threadId: 'th1' }));
    expect(api.updateTicketExecutionConfig).toHaveBeenCalledWith('t1', { conversationMode: 'edit' });
    expect(api.postAssistantMessage).toHaveBeenCalledWith('t1', 'Mode edit accordé aux agents — continue.');
    expect(api.updateTicketExecutionConfig.mock.invocationCallOrder[0]!).toBeLessThan(api.postAssistantMessage.mock.invocationCallOrder[0]!);
  });

  it('declining changes nothing on the ticket and tells the assistant the mode stays', async () => {
    const { result } = renderHook(() => useModeRequestActions('t1', 'plan'));
    await act(() => result.current.declineMode({ mode: 'edit', threadId: 'th1' }));
    expect(api.updateTicketExecutionConfig).not.toHaveBeenCalled();
    expect(api.postAssistantMessage).toHaveBeenCalledWith('t1', expect.stringContaining('restent en mode plan'));
  });
});
