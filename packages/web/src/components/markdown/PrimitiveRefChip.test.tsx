import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { PrimitiveRefChip } from './PrimitiveRefChip';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePanelStore } from '../../stores/panelStore';
import { useSkillStore } from '../../stores/skillStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useRoutineStore } from '../../stores/routineStore';
import { useUIStore } from '../../stores/uiStore';

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAgentPersonaStore.setState({ personas: [{ id: 'p1', name: 'catalyst' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  usePanelStore.setState({ panels: [{ id: 'pa1', name: 'squad' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useSkillStore.setState({ skills: [{ id: 's1', commandName: 'commit' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useWorkflowTemplateStore.setState({ templates: [{ id: 'w1', slug: 'deploy', name: 'Deploy' }] as any });
  useRoutineStore.setState({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    routines: [{ id: 'r1', slug: 'daily', name: 'Daily recap' }] as any,
    // Stubbed: the real action is async and fetches run history, which in jsdom
    // would leave an unhandled rejection and make this flaky for a reason that
    // has nothing to do with the chip. Which panel opens is what matters here.
    select: async () => {},
  });
});

afterEach(cleanup);

// A reference chip points somewhere; it never dispatches. These cases pin the
// destination for each kind, because four of the five share a panel and one
// does not.
describe('PrimitiveRefChip — navigation', () => {
  it('opens an agent in the agents panel', () => {
    const { getByRole } = render(<PrimitiveRefChip kind="agent" name="catalyst" />);
    fireEvent.click(getByRole('button'));
    expect(useUIStore.getState().activePanel).toBe('agents');
    expect(useAgentPersonaStore.getState().selectedPersonaId).toBe('p1');
  });

  it('opens a panel', () => {
    const { getByRole } = render(<PrimitiveRefChip kind="panel" name="squad" />);
    fireEvent.click(getByRole('button'));
    expect(useUIStore.getState().activePanel).toBe('agents');
    expect(usePanelStore.getState().selectedPanelId).toBe('pa1');
  });

  it('opens a skill by its command name', () => {
    const { getByRole } = render(<PrimitiveRefChip kind="skill" name="commit" />);
    fireEvent.click(getByRole('button'));
    expect(useSkillStore.getState().selectedSkillId).toBe('s1');
  });

  it('opens a workflow by its slug', () => {
    const { getByRole } = render(<PrimitiveRefChip kind="workflow" name="deploy" />);
    fireEvent.click(getByRole('button'));
    expect(useWorkflowTemplateStore.getState().selectedWorkflowId).toBe('w1');
  });

  it('opens a routine in the routines panel, not the agents one', () => {
    // The routine is the exception: its own panel, and `select` is async because
    // it loads the run history.
    const { getByRole } = render(<PrimitiveRefChip kind="routine" name="daily" />);
    fireEvent.click(getByRole('button'));
    expect(useUIStore.getState().activePanel).toBe('routines');
  });
});

describe('PrimitiveRefChip — label and degradation', () => {
  it('shows the readable name, never the raw syntax', () => {
    const { container } = render(<PrimitiveRefChip kind="agent" name="catalyst" />);
    expect(container.textContent).toContain('catalyst');
    expect(container.textContent).not.toContain('@agent:');
  });

  it('prefers a workflow display name over its slug', () => {
    const { container } = render(<PrimitiveRefChip kind="workflow" name="deploy" />);
    expect(container.textContent).toContain('Deploy');
  });

  it('degrades an unknown name to the text the author typed', () => {
    // Primitives are deletable; a chip leading nowhere is worse than the syntax.
    const { container, queryByRole } = render(<PrimitiveRefChip kind="agent" name="deleted" />);
    expect(container.textContent).toBe('@agent:deleted');
    expect(queryByRole('button')).toBeNull();
  });

  it('carries no remove affordance', () => {
    // The comment surface's actionable mention has one; a reference must not,
    // or it reads as something that can be cancelled.
    const { container } = render(<PrimitiveRefChip kind="agent" name="catalyst" />);
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });
});
