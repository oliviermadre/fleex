import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { Ticket } from '@fleex/shared';
import { TicketDetail } from './TicketDetail';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useSkillStore } from '../../stores/skillStore';

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't1',
    boardId: 'b1',
    displayId: 42,
    title: 'Fix auth loop',
    description: '',
    status: 'todo',
    priority: 'none',
    type: null,
    position: 0,
    tags: [],
    links: [],
    blocked: false,
    favorite: false,
    dueDate: null,
    assignee: null,
    agentClaimedAt: null,
    githubMetadata: null,
    archivedAt: null,
    firstDoingAt: null,
    statusChangedAt: '2026-07-01T00:00:00.000Z',
    conversationMode: 'plan',
    modelOverride: null,
    effortOverride: null,
    fastMode: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as Ticket;
}

function typeAt(el: HTMLTextAreaElement, value: string) {
  // See ScratchpadMainView.mentions.test.tsx for why `value`/`selectionStart`
  // must not be pre-assigned on `el` before this call (React 19 change-tracking).
  fireEvent.change(el, { target: { value, selectionStart: value.length } });
}

beforeEach(() => {
  // jsdom has no layout engine and no scrollIntoView — MentionMenu calls it
  // whenever the selected row changes.
  Element.prototype.scrollIntoView = vi.fn();
  // `updateTicket` fires on unmount once the description changed (to log a
  // single activity entry) and isn't wrapped in a `.catch()` — a real network
  // call would reject (no server in this test) as an unhandled rejection.
  useTicketStore.setState({ tickets: [makeTicket()], ticketTab: 'description', updateTicket: vi.fn() });
  // Collapsed meta sidebar: the expanded one calls `useNavigate()`, which
  // needs a Router this test doesn't otherwise care about standing up.
  useUIStore.setState({ ticketMetaSidebarCollapsed: true });
  /* eslint-disable @typescript-eslint/no-explicit-any */
  useAgentPersonaStore.setState({ personas: [{ id: 'p1', name: 'catalyst' }] as any });
  useSkillStore.setState({ skills: [{ id: 's1', commandName: 'commit' }] as any });
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

afterEach(() => {
  cleanup();
  useTicketStore.setState({ tickets: [] });
  useUIStore.setState({ ticketMetaSidebarCollapsed: false });
  useAgentPersonaStore.setState({ personas: [] });
  useSkillStore.setState({ skills: [] });
});

describe('TicketDetail — description mention autocomplete', () => {
  it('opens the mention menu in the description editor', () => {
    // The description never had a picker, on any primitive.
    const { container, getByText } = render(<TicketDetail ticketId="t1" embedded />);
    const textarea = container.querySelector('textarea')!;
    typeAt(textarea, '@');
    expect(getByText('catalyst')).toBeTruthy();
    expect(getByText('commit')).toBeTruthy();
  });
});
