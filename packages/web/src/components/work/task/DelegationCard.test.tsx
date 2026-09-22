import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import type { AgentThread, TicketComment } from '@fleex/shared';
import { DelegationCard } from './DelegationCard';

function thread(over: Partial<AgentThread> = {}): AgentThread {
  return {
    id: 'th1', ticketId: 't1', initiator: 'assistant', personaId: 'p', personaName: 'builder', assistantPersonaId: 'a',
    brief: 'Fix the e2e', forwardedContext: ['ticket', 'pr'], status: 'running', currentMentionId: 'm1', exchanges: 3, failures: 0,
    summary: null, createdAt: '2026-09-21T10:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z', concludedAt: null,
    ...over,
  };
}
function turn(over: Partial<TicketComment> & { id: string }): TicketComment {
  return {
    ticketId: 't1', authorType: 'agent', authorName: 'The Builder', body: 'working', visibility: 'public',
    privateRecipients: [], mentions: [], parentId: null, threadId: 'th1',
    createdAt: '2026-09-21T10:01:00.000Z', updatedAt: '2026-09-21T10:01:00.000Z', ...over,
  };
}

afterEach(cleanup);

describe('DelegationCard', () => {
  it('renders the pill label for each state', () => {
    for (const [status, label] of [['running', 'in progress'], ['waiting', 'waiting for you'], ['concluded', 'concluded'], ['failed', 'failed']] as const) {
      const { unmount } = render(<DelegationCard thread={thread({ status })} turns={[]} personaDisplayName="The Builder" onOpen={() => {}} onAnswer={() => {}} />);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });

  it('shows the last agent line and opens the thread from the footer', () => {
    const onOpen = vi.fn();
    render(<DelegationCard thread={thread()} turns={[turn({ id: 'a', body: 'je relance les 540 tests' })]} personaDisplayName="The Builder" onOpen={onOpen} onAnswer={() => {}} />);
    expect(screen.getByText(/je relance les 540 tests/)).toBeTruthy();
    fireEvent.click(screen.getByText('Open thread ›'));
    expect(onOpen).toHaveBeenCalledWith('th1');
  });

  it('in waiting state offers the agent question options and answers on click', () => {
    const onAnswer = vi.fn();
    render(
      <DelegationCard
        thread={thread({ status: 'waiting' })}
        turns={[turn({ id: 'q', body: 'Keep the fallback?\n- Keep\n- Drop' })]}
        personaDisplayName="The Builder"
        onOpen={() => {}}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(screen.getByText('Drop'));
    expect(onAnswer).toHaveBeenCalledWith('th1', 'Drop');
  });
});
