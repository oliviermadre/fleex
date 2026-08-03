import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

/**
 * Render-count guard for the assistant composer (#518).
 *
 * WHY this test exists: typing one character used to re-render the entire
 * assistant subtree, which re-parsed the markdown of EVERY message in the
 * conversation (cost O(conversation length) × O(keystrokes)). Two mistakes make
 * it come back, and both look harmless in review:
 *   1. lifting the composer's `draft` back into `AssistantConversation`;
 *   2. passing an inline `onToggleCheckbox={() => {}}` to `MarkdownRenderer`,
 *      whose new reference on each render defeats its `memo()`.
 *
 * So we assert on the observable consequence — markdown renders — rather than
 * on component internals. If this test goes red, the user-visible input lag is
 * back; do not relax the assertion.
 *
 * NOTE: `@testing-library/user-event` is not a dependency of this package, so
 * typing is simulated with `fireEvent.change`.
 */

const markdownRenders = vi.fn();

// The stub is `memo()`-wrapped like the real `MarkdownRenderer`: that memo is
// precisely what the fix relies on, so a bare function stub would silently
// pass tests that must fail (it re-renders unconditionally with its parent).
vi.mock('../scratchpad/MarkdownRenderer', async () => {
  const { memo } = await import('react');
  return {
    MarkdownRenderer: memo(function MarkdownRendererStub(props: {
      content: string;
      onToggleCheckbox: (line: number) => void;
    }) {
      markdownRenders(props.content);
      return <div data-testid="md">{props.content}</div>;
    }),
  };
});

// The composer's mention autocomplete talks to the network on mount; the panel
// header renders a model picker that does the same. Neither is under test here.
vi.mock('../agents/ModelSelect', () => ({ ModelSelect: () => null }));
vi.mock('../../services/api', () => ({
  uploadFile: vi.fn(),
  api: {},
}));

import { AssistantConversation } from './AssistantConversation';
import { AssistantTranscript } from './AssistantTranscript';
import { useAssistantStore, type AssistantChatItem } from '../../stores/assistantStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePanelStore } from '../../stores/panelStore';
import { useSkillStore } from '../../stores/skillStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useTicketStore } from '../../stores/ticketStore';
import type { Ticket, WorkflowTemplate } from '@fleex/shared';

const SESSION_ID = 'sess-1';

function seedStores() {
  useAssistantStore.setState({
    connected: true,
    activeId: SESSION_ID,
    sessions: [
      {
        id: SESSION_ID,
        title: 'Conversation de test',
        status: 'idle',
        messageCount: 3,
        createdAt: new Date().toISOString(),
      },
    ],
    itemsBySession: {
      [SESSION_ID]: [
        { kind: 'user', text: 'Salut' },
        { kind: 'assistant', text: '# Titre\n\nUne réponse **longue**.' },
        { kind: 'assistant', text: 'Une autre réponse.' },
      ],
    },
    confirmReqs: [],
    errorMsg: null,
    autoApproveNotice: null,
    ensureConnected: () => {},
    sendUser: vi.fn(),
  });

  // Mention sources: already "loaded" so the composer does not fetch on mount.
  // Only the fields the composer actually reads are provided — these are render
  // fixtures, not domain objects.
  useAgentPersonaStore.setState({ personas: [] });
  usePanelStore.setState({ panels: [], loaded: true, loadPanels: async () => {} });
  useSkillStore.setState({ skills: [], loaded: true, loadSkills: async () => {} });
  useWorkflowTemplateStore.setState({
    templates: [{ slug: 'x', name: 'X', enabled: true } as unknown as WorkflowTemplate],
    refresh: async () => {},
  });
  useTicketStore.setState({
    tickets: [{ id: 't1', displayId: 1, title: 'Un ticket' } as unknown as Ticket],
    fetchTickets: async () => {},
  });
}

beforeEach(seedStores);
afterEach(cleanup);

function typeInto(textarea: HTMLElement, value: string) {
  fireEvent.change(textarea, { target: { value } });
}

describe('AssistantConversation — keystroke isolation (#518)', () => {
  it('renders no markdown at all while the user types in the composer', () => {
    render(<AssistantConversation />);
    const textarea = screen.getByRole('textbox');

    // The transcript legitimately renders once on mount — we only care about
    // what typing costs afterwards.
    expect(markdownRenders).toHaveBeenCalled();
    markdownRenders.mockClear();

    typeInto(textarea, 'a');
    typeInto(textarea, 'ab');
    typeInto(textarea, 'abc');

    expect((textarea as HTMLTextAreaElement).value).toBe('abc');
    expect(markdownRenders).not.toHaveBeenCalled();
  });

  it('still sends the draft on Enter and clears the input', () => {
    const sendUser = vi.fn();
    useAssistantStore.setState({ sendUser });

    render(<AssistantConversation />);
    const textarea = screen.getByRole('textbox');

    typeInto(textarea, 'hello');
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(sendUser).toHaveBeenCalledWith('hello');
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('leaves the draft alone on Shift+Enter (newline, not send)', () => {
    const sendUser = vi.fn();
    useAssistantStore.setState({ sendUser });

    render(<AssistantConversation />);
    const textarea = screen.getByRole('textbox');

    typeInto(textarea, 'ligne 1');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(sendUser).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toBe('ligne 1');
  });

  it('opens the mention autocomplete on "@" without re-rendering the transcript', () => {
    render(<AssistantConversation />);
    const textarea = screen.getByRole('textbox');
    markdownRenders.mockClear();

    typeInto(textarea, '@x');

    expect(screen.getByText('X')).toBeTruthy();
    expect(markdownRenders).not.toHaveBeenCalled();
  });
});

describe('AssistantTranscript — markdown is parsed from content only (#518)', () => {
  /**
   * Guards the stable `onToggleCheckbox` reference specifically. The store
   * rebuilds item objects wholesale on session load and on reconnect, so a
   * message whose text has not changed WILL be handed a fresh object — and it
   * must still not be re-parsed. An inline `onToggleCheckbox={() => {}}` breaks
   * exactly this: `memo(MarkdownRenderer)` sees a new prop reference and
   * re-parses every message in the conversation.
   */
  it('does not re-parse messages whose text is unchanged, even on fresh item objects', () => {
    const texts = ['Salut', '# Titre\n\nUne réponse **longue**.'];
    const build = (): AssistantChatItem[] => [
      { kind: 'user', text: texts[0]! },
      { kind: 'assistant', text: texts[1]! },
    ];

    const { rerender } = render(
      <AssistantTranscript items={build()} busy={false} statusLabel="Réflexion…" errorMsg={null} />,
    );
    expect(markdownRenders).toHaveBeenCalledTimes(2);
    markdownRenders.mockClear();

    // Same texts, brand-new objects and a new array — plus an unrelated prop
    // change so the transcript itself genuinely re-renders.
    rerender(<AssistantTranscript items={build()} busy statusLabel="Réflexion…" errorMsg={null} />);

    expect(markdownRenders).not.toHaveBeenCalled();
  });

  it('does re-parse a message whose text actually changed (streaming still works)', () => {
    const { rerender } = render(
      <AssistantTranscript
        items={[{ kind: 'assistant', text: 'Une ré' }]}
        busy
        statusLabel="Réflexion…"
        errorMsg={null}
      />,
    );
    markdownRenders.mockClear();

    rerender(
      <AssistantTranscript
        items={[{ kind: 'assistant', text: 'Une réponse' }]}
        busy
        statusLabel="Réflexion…"
        errorMsg={null}
      />,
    );

    expect(markdownRenders).toHaveBeenCalledWith('Une réponse');
  });
});
