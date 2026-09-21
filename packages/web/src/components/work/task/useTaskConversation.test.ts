import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const api = vi.hoisted(() => ({
  fetchTicketComments: vi.fn(async () => []),
  fetchTicketActivity: vi.fn(async () => []),
  postAssistantMessage: vi.fn(),
  postTicketComment: vi.fn(async () => ({})),
  postThreadMessage: vi.fn(async () => ({})),
}));
vi.mock('../../../services/api', () => api);
vi.mock('../../../services/websocket', () => ({ appWs: { onChannel: () => () => {} } }));

import { useTaskConversation } from './useTaskConversation';
import { useSettingsStore } from '../../../stores/settingsStore';

describe('useTaskConversation.post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, workThreadsEnabled: undefined } }));
  });

  it('sends the message to the assistant when threads are enabled', async () => {
    api.postAssistantMessage.mockResolvedValue({ comment: { id: 'c' }, assistant: { personaId: 'p', displayName: 'Nas' } });
    const { result } = renderHook(() => useTaskConversation('t1'));
    await act(() => result.current.post('hello'));
    expect(api.postAssistantMessage).toHaveBeenCalledWith('t1', 'hello');
    expect(api.postTicketComment).not.toHaveBeenCalled();
    expect(result.current.assistantMissing).toBe(false);
  });

  it('falls back to a plain comment and flags assistantMissing when no assistant is configured', async () => {
    api.postAssistantMessage.mockResolvedValue({ comment: null, assistant: null });
    const { result } = renderHook(() => useTaskConversation('t1'));
    await act(() => result.current.post('hello'));
    expect(api.postTicketComment).toHaveBeenCalledWith('t1', 'hello');
    expect(result.current.assistantMissing).toBe(true);
  });

  it('posts a plain comment when the flag is off', async () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, workThreadsEnabled: false } }));
    const { result } = renderHook(() => useTaskConversation('t1'));
    await act(() => result.current.post('hello'));
    expect(api.postAssistantMessage).not.toHaveBeenCalled();
    expect(api.postTicketComment).toHaveBeenCalledWith('t1', 'hello');
  });

  it('postToThread posts inside the thread', async () => {
    const { result } = renderHook(() => useTaskConversation('t1'));
    await act(() => result.current.postToThread('th1', 'Drop'));
    expect(api.postThreadMessage).toHaveBeenCalledWith('th1', 'Drop');
  });
});
