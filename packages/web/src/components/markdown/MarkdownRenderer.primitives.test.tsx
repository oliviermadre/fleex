import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useSkillStore } from '../../stores/skillStore';
import { useRoutineStore } from '../../stores/routineStore';
import { useUIStore } from '../../stores/uiStore';

const noop = () => {};

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAgentPersonaStore.setState({ personas: [{ id: 'p1', name: 'catalyst' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useSkillStore.setState({ skills: [{ id: 's1', commandName: 'commit' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useRoutineStore.setState({ routines: [{ id: 'r1', slug: 'daily', name: 'Daily recap' }] as any });
});

afterEach(cleanup);

// The generic renderer backs notes, the ticket description, deliverables, the
// assistant transcript and all of mobile — so a primitive resolved here is
// resolved on every one of them.
describe('MarkdownRenderer — primitive references', () => {
  it('renders an agent reference as a chip that navigates', () => {
    const { getByRole } = render(
      <MarkdownRenderer content="ask @agent:catalyst about it" onToggleCheckbox={noop} />,
    );
    fireEvent.click(getByRole('button'));
    expect(useUIStore.getState().activePanel).toBe('agents');
    expect(useAgentPersonaStore.getState().selectedPersonaId).toBe('p1');
  });

  it('renders a skill reference', () => {
    const { container } = render(
      <MarkdownRenderer content="run @skill:commit first" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('commit');
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders a routine reference with its display name', () => {
    const { container } = render(
      <MarkdownRenderer content="see @routine:daily" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('Daily recap');
  });

  it('renders a struck mention as strikethrough, not a link', () => {
    const { container } = render(
      <MarkdownRenderer content="~~@agent:catalyst~~ is done" onToggleCheckbox={noop} />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('catalyst');
  });

  it('renders a human mention as a pill that does not navigate', () => {
    const before = useUIStore.getState().activePanel;
    const { container } = render(
      <MarkdownRenderer content="asked @olivier" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('@olivier');
    expect(container.querySelector('a')).toBeNull();
    expect(useUIStore.getState().activePanel).toBe(before);
  });

  it('leaves a primitive inside a code span alone', () => {
    const { container, queryByRole } = render(
      <MarkdownRenderer content="write `@agent:catalyst` verbatim" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('@agent:catalyst');
    expect(queryByRole('button')).toBeNull();
  });

  it('degrades an unknown primitive to plain text', () => {
    const { container, queryByRole } = render(
      <MarkdownRenderer content="ask @agent:deleted" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('@agent:deleted');
    expect(queryByRole('button')).toBeNull();
  });
});
