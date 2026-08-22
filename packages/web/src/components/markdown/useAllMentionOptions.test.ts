import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAllMentionOptions } from './useAllMentionOptions';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePanelStore } from '../../stores/panelStore';
import { useSkillStore } from '../../stores/skillStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useRoutineStore } from '../../stores/routineStore';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTicketStore } from '../../stores/ticketStore';

beforeEach(() => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  useAgentPersonaStore.setState({ personas: [{ id: 'p1', name: 'catalyst', enabled: true }] as any });
  usePanelStore.setState({ panels: [{ id: 'pa1', name: 'squad', enabled: true }] as any });
  useSkillStore.setState({ skills: [{ id: 's1', commandName: 'commit', enabled: true }] as any });
  useWorkflowTemplateStore.setState({ templates: [{ id: 'w1', slug: 'deploy', name: 'Deploy', enabled: true }] as any });
  useRoutineStore.setState({ routines: [{ id: 'r1', slug: 'daily', name: 'Daily recap' }] as any });
  useScratchpadStore.setState({ scratchpadList: [{ key: '__global__', label: 'Global', lineCount: 3 }] as any });
  useTicketStore.setState({ tickets: [{ id: 't1', displayId: 42, title: 'Tokens expire' }] as any });
  // The hook only offers a human option when this setting is present, so the
  // eighth kind is untestable without it.
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, humanMentionName: 'olivier' } as any,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

describe('useAllMentionOptions', () => {
  it('offers all eight kinds', () => {
    const { result } = renderHook(() => useAllMentionOptions());
    const kinds = new Set(result.current.map((o) => o.type));
    expect(kinds).toEqual(new Set(['agent', 'panel', 'skill', 'workflow', 'routine', 'scratchpad', 'ticket', 'human']));
  });

  it('spells the global note `global`, never its storage key', () => {
    const { result } = renderHook(() => useAllMentionOptions());
    const note = result.current.find((o) => o.type === 'scratchpad');
    expect(note?.insertText).toBe('@scratchpad:global');
  });

  it('marks tickets deferred so a bare @ does not dump them all', () => {
    const { result } = renderHook(() => useAllMentionOptions());
    expect(result.current.find((o) => o.type === 'ticket')?.deferred).toBe(true);
  });

  it('does not defer the primitives, which are few', () => {
    const { result } = renderHook(() => useAllMentionOptions());
    for (const kind of ['agent', 'panel', 'skill', 'workflow', 'routine']) {
      expect(result.current.find((o) => o.type === kind)?.deferred).not.toBe(true);
    }
  });

  it('inserts a skill by its command name and a workflow by its slug', () => {
    const { result } = renderHook(() => useAllMentionOptions());
    expect(result.current.find((o) => o.type === 'skill')?.insertText).toBe('@skill:commit');
    expect(result.current.find((o) => o.type === 'workflow')?.insertText).toBe('@workflow:deploy');
  });

  it('inserts a routine by its slug and labels it by its name', () => {
    const { result } = renderHook(() => useAllMentionOptions());
    const routine = result.current.find((o) => o.type === 'routine');
    expect(routine?.insertText).toBe('@routine:daily');
    expect(routine?.label).toBe('Daily recap');
  });
});
