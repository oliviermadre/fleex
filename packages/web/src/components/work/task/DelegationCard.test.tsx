import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import type { AgentThread, TicketComment } from '@fleex/shared';
import { DelegationCard } from './DelegationCard';

function thread(over: Partial<AgentThread> = {}): AgentThread {
  return {
    id: 'th1', ticketId: 't1', initiator: 'assistant', targetType: 'agent', personaId: 'p', personaName: 'builder', assistantPersonaId: 'a',
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

  it('in waiting state offers the options the agent declared and answers on click', () => {
    const onAnswer = vi.fn();
    render(
      <DelegationCard
        thread={thread({ status: 'waiting' })}
        turns={[turn({ id: 'q', body: 'Keep the fallback?', questions: [{ prompt: 'Keep the fallback?', options: ['Keep', 'Drop'] }] })]}
        personaDisplayName="The Builder"
        onOpen={() => {}}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(screen.getByText('Drop'));
    expect(onAnswer).toHaveBeenCalledWith('th1', 'Drop');
  });

  it('never guesses buttons from a bullet list the agent did not declare as questions', () => {
    render(
      <DelegationCard
        thread={thread({ status: 'waiting' })}
        turns={[turn({ id: 'q', body: 'Keep the fallback?\n- Keep\n- Drop' })]}
        personaDisplayName="The Builder"
        onOpen={() => {}}
        onAnswer={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Drop' })).toBeNull();
  });

  // Lot 2: a wanted stop is named, in the neutral idle tint — never the red of a failure.
  describe('a run stopped on purpose', () => {
    const at = '2026-09-21T10:05:00.000Z';
    const stopped = (by: 'user' | 'assistant') => thread({ status: 'idle', lastStop: { by, at, reason: null, mentionId: 'm1' }, userHoldAt: by === 'user' ? at : null });

    it('stopped by the user: « Arrêté par toi », neutral, with « Relancer » that calls back with the thread', () => {
      const onRelaunch = vi.fn();
      render(<DelegationCard thread={stopped('user')} turns={[]} personaDisplayName="The Builder" onOpen={() => {}} onAnswer={() => {}} onRelaunch={onRelaunch} />);
      const pill = screen.getByText('Arrêté par toi');
      expect(pill.className).toContain('gray');
      expect(pill.className).not.toContain('red');
      expect(screen.queryByText('paused')).toBeNull();
      fireEvent.click(screen.getByText('Relancer'));
      expect(onRelaunch).toHaveBeenCalledWith('th1');
    });

    it("stopped by the assistant: « Arrêté par l'assistant », and no « Relancer » — nothing is held", () => {
      render(<DelegationCard thread={stopped('assistant')} turns={[]} personaDisplayName="The Builder" onOpen={() => {}} onAnswer={() => {}} onRelaunch={() => {}} />);
      expect(screen.getByText("Arrêté par l'assistant").className).toContain('gray');
      expect(screen.queryByText('Relancer')).toBeNull();
    });

    it('once relaunched the label is gone: the thread is simply in progress', () => {
      render(<DelegationCard thread={thread({ status: 'running', lastStop: null, userHoldAt: null })} turns={[]} personaDisplayName="The Builder" onOpen={() => {}} onAnswer={() => {}} onRelaunch={() => {}} />);
      expect(screen.getByText('in progress')).toBeTruthy();
      expect(screen.queryByText('Relancer')).toBeNull();
    });
  });
});
