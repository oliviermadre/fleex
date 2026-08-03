import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';


import { usePanelStore } from '../../stores/panelStore';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSkillStore } from '../../stores/skillStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';

import { useMainViewKey } from './useMainViewKey';

/**
 * This key is the reset mechanism for the main-view error boundary. What
 * matters is not the exact string but that it CHANGES whenever the user has
 * navigated to different content — otherwise a crash screen outlives the view
 * that crashed and follows the user onto a healthy one.
 */

/**
 * Reads the key from a throwaway mount. Unmounting matters: a hook left
 * subscribed to the zustand stores would re-render on every later `setState`
 * and drown the run in act() warnings.
 */
function key(): string {
  const { result, unmount } = renderHook(() => useMainViewKey());
  const value = result.current;
  unmount();
  return value;
}

function resetStores(): void {
  useUIStore.setState({
    activePanel: 'dashboard',
    selectedRepoKey: null,
    selectedAgentWorktreeTicketId: null,
  });
  useSessionStore.setState({
    selectedTicketId: null,
    selectedSessionId: null,
    selectedGroupId: null,
  });
  useTicketStore.setState({ selectedTicketId: null });
  useSkillStore.setState({ selectedSkillId: null });
  usePanelStore.setState({ selectedPanelId: null });
  useScratchpadStore.setState({ selectedScratchpadKey: null });
  useWorkflowTemplateStore.setState({ selectedWorkflowId: null });
}

describe('useMainViewKey', () => {
  beforeEach(resetStores);

  it('changes when the active panel changes', () => {
    useUIStore.setState({ activePanel: 'analytics' });
    const analytics = key();

    useUIStore.setState({ activePanel: 'documents' });
    expect(key()).not.toBe(analytics);
  });

  // The regression that motivated keying at all: crash on ticket A, click
  // ticket B, and the boundary must not still be showing A's crash screen.
  it('changes when the selected ticket changes within the tickets panel', () => {
    useUIStore.setState({ activePanel: 'tickets' });
    useTicketStore.setState({ selectedTicketId: 'ticket-a' });
    const ticketA = key();

    useTicketStore.setState({ selectedTicketId: 'ticket-b' });
    expect(key()).not.toBe(ticketA);
  });

  it('distinguishes the ticket board from an open ticket', () => {
    useUIStore.setState({ activePanel: 'tickets' });
    expect(key()).toBe('tickets:board');

    useTicketStore.setState({ selectedTicketId: 'ticket-a' });
    expect(key()).toBe('tickets:ticket-a');
  });

  it('changes when the selected repository changes', () => {
    useUIStore.setState({ activePanel: 'repositories', selectedRepoKey: 'org/one' });
    const one = key();

    useUIStore.setState({ selectedRepoKey: 'org/two' });
    expect(key()).not.toBe(one);
  });

  it('changes when the selected scratchpad changes', () => {
    useUIStore.setState({ activePanel: 'scratchpads' });
    useScratchpadStore.setState({ selectedScratchpadKey: '__global__' });
    const global = key();

    useScratchpadStore.setState({ selectedScratchpadKey: 'org/repo' });
    expect(key()).not.toBe(global);
  });

  it('follows MainPanel precedence inside the agents panel', () => {
    useUIStore.setState({ activePanel: 'agents' });
    expect(key()).toBe('agents:personas');

    useWorkflowTemplateStore.setState({ selectedWorkflowId: 'wf-1' });
    expect(key()).toBe('agents:workflow:wf-1');

    // A selected skill outranks a selected workflow, as in MainPanel.
    useSkillStore.setState({ selectedSkillId: 'skill-1' });
    expect(key()).toBe('agents:skill:skill-1');

    // A selected panel outranks both.
    usePanelStore.setState({ selectedPanelId: 'panel-1' });
    expect(key()).toBe('agents:panel:panel-1');
  });

  it('changes between session sub-views', () => {
    useUIStore.setState({ activePanel: 'sessions' });
    useSessionStore.setState({ selectedTicketId: 'ticket-1' });
    const ticketSession = key();

    useSessionStore.setState({ selectedTicketId: 'ticket-2' });
    expect(key()).not.toBe(ticketSession);

    useSessionStore.setState({ selectedTicketId: null, selectedGroupId: 'group-1' });
    const group = key();
    useSessionStore.setState({ selectedGroupId: 'group-2' });
    expect(key()).not.toBe(group);
  });

  it('keys the cluster panel by group too, since MainPanel renders group views there', () => {
    useUIStore.setState({ activePanel: 'cluster' });
    useSessionStore.setState({ selectedGroupId: 'group-1' });
    const first = key();

    useSessionStore.setState({ selectedGroupId: 'group-2' });
    expect(key()).not.toBe(first);
  });

  it('is stable when nothing relevant changed, so views are not needlessly remounted', () => {
    useUIStore.setState({ activePanel: 'analytics' });
    expect(key()).toBe(key());
  });
});
