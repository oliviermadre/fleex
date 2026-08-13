import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { Ticket } from '@fleex/shared';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useTicketStore } from '../../stores/ticketStore';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';

function ticket(id: string, displayId: number, title: string): Ticket {
  return { id, displayId, title, boardId: 'b1' } as unknown as Ticket;
}

function setEngine(engine: 'legacy' | 'semantic', wikiLinks?: boolean) {
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      memoryEngine: engine,
      ...(wikiLinks === undefined ? {} : { memoryFeatures: { wikiLinks } }),
    },
  });
}

beforeEach(() => {
  setEngine('semantic');
});

afterEach(() => {
  cleanup();
  useTicketStore.setState({ tickets: [], selectedTicketId: null });
  useScratchpadStore.setState({ selectedScratchpadKey: null });
  setEngine('legacy');
});

const noop = () => {};

// The generic renderer backs the notes, the ticket description and deliverables,
// so a link resolved here is resolved on all three.
describe('MarkdownRenderer — wiki links', () => {
  it('renders [[#42]] as the same chip a @ticket mention gets', () => {
    useTicketStore.setState({ tickets: [ticket('t1', 42, 'Session tokens expire early')] });
    const { container, getByRole } = render(
      <MarkdownRenderer content="caused by [[#42]] probably" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('Session tokens expire early');

    fireEvent.click(getByRole('button'));
    expect(useTicketStore.getState().selectedTicketId).toBe('t1');
  });

  it('navigates to a note for [[org/repo]]', () => {
    const { getByRole } = render(
      <MarkdownRenderer content="conventions live in [[acme/app]]" onToggleCheckbox={noop} />,
    );
    fireEvent.click(getByRole('button'));
    expect(useUIStore.getState().activePanel).toBe('scratchpads');
    expect(useScratchpadStore.getState().selectedScratchpadKey).toBe('acme/app');
  });

  it('resolves [[global]] to the global note key', () => {
    const { getByRole } = render(
      <MarkdownRenderer content="see [[global]]" onToggleCheckbox={noop} />,
    );
    fireEvent.click(getByRole('button'));
    expect(useScratchpadStore.getState().selectedScratchpadKey).toBe('__global__');
  });

  it('shows the alias, not the target', () => {
    const { container } = render(
      <MarkdownRenderer content="see [[acme/app|our conventions]]" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('our conventions');
    expect(container.textContent).not.toContain('acme/app');
  });

  it('leaves an unresolvable target as the text that was typed', () => {
    const { container } = render(
      <MarkdownRenderer content="see [[the auth module]]" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('[[the auth module]]');
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders nothing clickable under the legacy engine', () => {
    // The server resolves the same syntax into backlinks behind the same flag;
    // rendering here while that is off would offer half a graph.
    setEngine('legacy');
    const { container } = render(
      <MarkdownRenderer content="see [[acme/app]]" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('[[acme/app]]');
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders nothing clickable when the feature is switched off', () => {
    setEngine('semantic', false);
    const { container } = render(
      <MarkdownRenderer content="see [[acme/app]]" onToggleCheckbox={noop} />,
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('keeps checkbox line indices valid around a link', () => {
    let toggled: number | null = null;
    const { container } = render(
      <MarkdownRenderer
        content={'intro\n\n- [ ] first\n- [ ] read [[acme/app]] and reply'}
        onToggleCheckbox={(line) => { toggled = line; }}
      />,
    );
    const items = container.querySelectorAll('.flex.items-start');
    fireEvent.click(items[1]!);
    // Line 3 of the original content — a rewritten link must not shift it.
    expect(toggled).toBe(3);
  });
});
