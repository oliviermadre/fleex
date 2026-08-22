import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePanelStore } from '../../stores/panelStore';
import { useSkillStore } from '../../stores/skillStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useRoutineStore } from '../../stores/routineStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';

const noop = () => {};

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAgentPersonaStore.setState({ personas: [{ id: 'p1', name: 'catalyst' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  usePanelStore.setState({ panels: [{ id: 'pa1', name: 'squad' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useSkillStore.setState({ skills: [{ id: 's1', commandName: 'commit' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useWorkflowTemplateStore.setState({ templates: [{ id: 'w1', slug: 'deploy', name: 'Deploy' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useRoutineStore.setState({ routines: [{ id: 'r1', slug: 'daily', name: 'Daily recap' }] as any });
  // The configured human — needed so the "pill" test actually exercises the
  // pilled branch, and so the false-positive regression tests below (a package
  // name, an email address) can prove they are NOT pilled against a real value.
  useSettingsStore.setState({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: { ...useSettingsStore.getState().settings, humanMentionName: 'olivier' } as any,
  });
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

  it('renders a panel reference as a chip that navigates', () => {
    const { getByRole } = render(
      <MarkdownRenderer content="check @panel:squad" onToggleCheckbox={noop} />,
    );
    fireEvent.click(getByRole('button'));
    expect(useUIStore.getState().activePanel).toBe('agents');
    expect(usePanelStore.getState().selectedPanelId).toBe('pa1');
  });

  it('renders a skill reference', () => {
    const { container } = render(
      <MarkdownRenderer content="run @skill:commit first" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('commit');
    // Guards against broken prefix stripping: a degraded fallback (unresolved
    // lookup) would render the literal `@skill:skill:commit`, which also
    // contains "commit" and would make the assertion above pass regardless.
    expect(container.textContent).not.toContain('skill:skill');
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders a workflow reference with its display name', () => {
    const { container, getByRole } = render(
      <MarkdownRenderer content="run @workflow:deploy" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('Deploy');
    fireEvent.click(getByRole('button'));
    expect(useWorkflowTemplateStore.getState().selectedWorkflowId).toBe('w1');
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

  // The `@[a-zA-Z0-9_-]+` human fallback has no boundary guard, so it matches
  // any `@word` — including one that is not a mention at all. These three pin
  // down that an unconfigured name is never pilled, and a mention inside an
  // existing Markdown link never destroys that link.
  it('leaves a shell command with a package name intact, unpilled', () => {
    const { container } = render(
      <MarkdownRenderer content="run bun --filter @fleex/web test" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('run bun --filter @fleex/web test');
    expect(container.querySelector('a')).toBeNull();
  });

  it('leaves an email address intact, unpilled', () => {
    const { container } = render(
      <MarkdownRenderer content="mail olivier@evaneos.com" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('mail olivier@evaneos.com');
    expect(container.querySelector('a')).toBeNull();
  });

  it('leaves a mention inside a Markdown link intact and keeps the link functional', () => {
    const { getByRole } = render(
      <MarkdownRenderer
        content="[ping @olivier](https://example.com)"
        onToggleCheckbox={noop}
      />,
    );
    const link = getByRole('link');
    expect(link.textContent).toBe('ping @olivier');
    expect(link.getAttribute('href')).toBe('https://example.com');
  });
});
