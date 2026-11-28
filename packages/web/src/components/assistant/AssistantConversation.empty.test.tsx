import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

// Not under test: the composer and the model picker (both talk to the network).
vi.mock('./AssistantComposer', () => ({ AssistantComposer: () => null }));
vi.mock('../agents/ModelSelect', () => ({ ModelSelect: () => null }));

import { AssistantConversation } from './AssistantConversation';
import { ASSISTANT_SUGGESTIONS } from './AssistantSuggestions';
import { useAssistantStore, type AssistantChatItem } from '../../stores/assistantStore';

// State `vide` of the spec (QA F4): a NEW conversation — not only "no conversation
// selected" — shows what the assistant can now do, and one click sends the prompt.
function seed(items: AssistantChatItem[], status: 'idle' | 'working' = 'idle') {
  const sendUser = vi.fn();
  useAssistantStore.setState({
    connected: true,
    activeId: 's1',
    sessions: [{ id: 's1', title: 'Nouvelle conversation', status, messageCount: items.length, createdAt: new Date().toISOString() }],
    itemsBySession: { s1: items },
    confirmReqs: [],
    errorMsg: null,
    ensureConnected: () => {},
    sendUser,
  });
  return sendUser;
}

afterEach(cleanup);

describe('AssistantConversation — empty conversation', () => {
  it('shows the suggestions in a fresh conversation and sends the one clicked', () => {
    const sendUser = seed([]);
    render(<AssistantConversation />);
    const first = screen.getByRole('button', { name: ASSISTANT_SUGGESTIONS[0] });
    fireEvent.click(first);
    expect(sendUser).toHaveBeenCalledWith(ASSISTANT_SUGGESTIONS[0]);
  });

  it('hides them once the conversation has started', () => {
    seed([{ kind: 'user', text: 'bonjour' }]);
    render(<AssistantConversation />);
    expect(screen.queryByRole('button', { name: ASSISTANT_SUGGESTIONS[0] })).toBeNull();
  });

  it('hides them while the first turn is running', () => {
    seed([], 'working');
    render(<AssistantConversation />);
    expect(screen.queryByRole('button', { name: ASSISTANT_SUGGESTIONS[0] })).toBeNull();
  });
});
