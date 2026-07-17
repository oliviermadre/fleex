import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import type { Skill, WorkflowTemplate, Panel, AgentPersona } from '@fleex/shared';
import { SmartSessionButton } from './SmartSessionButton';
import * as api from '../../services/api';
import { useToastStore } from '../../stores/toastStore';
import { useSkillStore } from '../../stores/skillStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { usePanelStore } from '../../stores/panelStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useFrequentLaunchStore } from '../../stores/frequentLaunchStore';

/**
 * These tests pin the *intent* of the fix: launching an action from the
 * SmartSessionButton must give the user visible confirmation — a success toast,
 * an error toast (errors are no longer swallowed), and a transient "Launching…"
 * acknowledgement on the button itself. A test that could still pass if the
 * launch silently no-op'd would defeat the purpose, so each asserts the toast
 * the user would actually see.
 */

const skill: Skill = {
  id: 's1',
  commandName: 'prepare',
  name: 'prepare',
  displayName: 'Prepare',
  markdownContent: '',
  enabled: true,
  personaId: 'p1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const template: WorkflowTemplate = {
  id: 'w1',
  name: 'Deploy',
  slug: 'deploy',
  emoji: '🚀',
  description: '',
  steps: [],
  edges: [],
  entryStepId: '',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const panel: Panel = {
  id: 'pn1',
  name: 'archi-committee',
  displayName: 'Archi Committee',
  description: '',
  executionMode: 'claude_code',
  members: [],
  orchestratorPrompt: '',
  orchestratorModel: '',
  orchestratorPersonaId: null,
  defaultMemberModel: '',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const persona: AgentPersona = {
  id: 'ap1',
  name: 'catalyst',
  displayName: 'The Catalyst',
  model: '',
  executionMode: 'claude_code',
  soulMd: '',
  identityMd: '',
  memoryMd: '',
  humanMentionName: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function messages(): string[] {
  return useToastStore.getState().toasts.map((t) => t.message);
}

function toastTypeFor(message: string) {
  return useToastStore.getState().toasts.find((t) => t.message === message)?.type;
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  useSkillStore.setState({ skills: [] });
  // refresh is fired from a useEffect on mount — stub it so no network is hit.
  useWorkflowTemplateStore.setState({
    templates: [],
    refresh: vi.fn().mockResolvedValue(undefined),
  });
  useWorkflowRunStore.setState({ start: vi.fn().mockResolvedValue({}) });
  // Panels / personas / frequents are loaded lazily on first open — stub the
  // loaders and seed empty state so no network is hit and Fréquents stays hidden.
  usePanelStore.setState({ panels: [], loaded: true, loadPanels: vi.fn().mockResolvedValue(undefined) });
  useAgentPersonaStore.setState({ personas: [], loaded: true, loadPersonas: vi.fn().mockResolvedValue(undefined) });
  useFrequentLaunchStore.setState({ stats: null, loadedAt: Date.now(), loading: false, load: vi.fn().mockResolvedValue(undefined) });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Open the dropdown by clicking the collapsed trigger. */
async function openDropdown() {
  await act(async () => {
    fireEvent.click(screen.getByText('Start'));
  });
}

describe('SmartSessionButton — launch feedback', () => {
  describe('workflow', () => {
    beforeEach(() => {
      useWorkflowTemplateStore.setState({ templates: [template] });
    });

    it('shows a success toast when the workflow starts', async () => {
      useWorkflowRunStore.setState({ start: vi.fn().mockResolvedValue({}) });
      render(<SmartSessionButton sessions={[]} ticketId="t1" />);
      await openDropdown();

      await act(async () => {
        fireEvent.click(screen.getByText('Deploy'));
      });

      expect(messages()).toContain('🚦 Workflow "Deploy" lancé');
      expect(toastTypeFor('🚦 Workflow "Deploy" lancé')).toBe('success');
    });

    it('surfaces an error toast (not a silent console.error) when the start fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      useWorkflowRunStore.setState({ start: vi.fn().mockRejectedValue(new Error('boom')) });
      render(<SmartSessionButton sessions={[]} ticketId="t1" />);
      await openDropdown();

      await act(async () => {
        fireEvent.click(screen.getByText('Deploy'));
      });

      expect(messages()).toContain('Échec du lancement du workflow "Deploy"');
      expect(toastTypeFor('Échec du lancement du workflow "Deploy"')).toBe('error');
      expect(consoleError).toHaveBeenCalled();
    });

    it('shows a transient "Launching…" state on the button until the start resolves', async () => {
      let resolveStart!: (v: unknown) => void;
      const pending = new Promise((r) => {
        resolveStart = r;
      });
      useWorkflowRunStore.setState({ start: vi.fn().mockReturnValue(pending) });
      render(<SmartSessionButton sessions={[]} ticketId="t1" />);
      await openDropdown();

      // Sync click: the button flips to "Launching…" before the promise settles.
      act(() => {
        fireEvent.click(screen.getByText('Deploy'));
      });
      expect(screen.getByText('Launching…')).toBeTruthy();

      await act(async () => {
        resolveStart({});
        await pending;
      });
      expect(screen.queryByText('Launching…')).toBeNull();
      expect(messages()).toContain('🚦 Workflow "Deploy" lancé');
    });
  });

  describe('skill', () => {
    beforeEach(() => {
      useSkillStore.setState({ skills: [skill] });
    });

    it('shows a success toast and forwards the skill id when execution starts', async () => {
      const onExecuteSkill = vi.fn().mockResolvedValue(undefined);
      render(<SmartSessionButton sessions={[]} ticketId="t1" onExecuteSkill={onExecuteSkill} />);
      await openDropdown();

      await act(async () => {
        fireEvent.click(screen.getByText('Prepare'));
      });

      expect(onExecuteSkill).toHaveBeenCalledWith('s1');
      expect(messages()).toContain('🧩 Skill /prepare lancé');
      expect(toastTypeFor('🧩 Skill /prepare lancé')).toBe('success');
    });

    it('surfaces an error toast when the skill fails to launch', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onExecuteSkill = vi.fn().mockRejectedValue(new Error('nope'));
      render(<SmartSessionButton sessions={[]} ticketId="t1" onExecuteSkill={onExecuteSkill} />);
      await openDropdown();

      await act(async () => {
        fireEvent.click(screen.getByText('Prepare'));
      });

      expect(messages()).toContain('Échec du lancement du skill /prepare');
      expect(toastTypeFor('Échec du lancement du skill /prepare')).toBe('error');
      expect(consoleError).toHaveBeenCalled();
    });
  });

  describe('panel', () => {
    beforeEach(() => {
      usePanelStore.setState({ panels: [panel], loaded: true, loadPanels: vi.fn().mockResolvedValue(undefined) });
    });

    it('launches the panel on the current ticket and shows a success toast', async () => {
      const executePanel = vi.spyOn(api, 'executePanel').mockResolvedValue({ status: 'started', panelId: 'pn1', ticketId: 't1' });
      render(<SmartSessionButton sessions={[]} ticketId="t1" />);
      await openDropdown();

      await act(async () => {
        fireEvent.click(screen.getByText('Archi Committee'));
      });

      expect(executePanel).toHaveBeenCalledWith('pn1', 't1');
      expect(messages()).toContain('🏛️ Panel "Archi Committee" lancé');
      expect(toastTypeFor('🏛️ Panel "Archi Committee" lancé')).toBe('success');
    });

    it('surfaces an error toast when the panel fails to launch', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(api, 'executePanel').mockRejectedValue(new Error('boom'));
      render(<SmartSessionButton sessions={[]} ticketId="t1" />);
      await openDropdown();

      await act(async () => {
        fireEvent.click(screen.getByText('Archi Committee'));
      });

      expect(messages()).toContain('Échec du lancement du panel "Archi Committee"');
      expect(toastTypeFor('Échec du lancement du panel "Archi Committee"')).toBe('error');
      expect(consoleError).toHaveBeenCalled();
    });
  });

  describe('persona', () => {
    beforeEach(() => {
      useAgentPersonaStore.setState({ personas: [persona], loaded: true, loadPersonas: vi.fn().mockResolvedValue(undefined) });
    });

    it('launches a persona by posting an @agent mention on the ticket', async () => {
      const postComment = vi.spyOn(api, 'postTicketComment').mockResolvedValue({} as never);
      render(<SmartSessionButton sessions={[]} ticketId="t1" />);
      await openDropdown();

      await act(async () => {
        fireEvent.click(screen.getByText('The Catalyst'));
      });

      expect(postComment).toHaveBeenCalledWith('t1', '@agent:catalyst');
      expect(messages()).toContain('🧠 Persona "The Catalyst" lancé');
      expect(toastTypeFor('🧠 Persona "The Catalyst" lancé')).toBe('success');
    });

    it('surfaces an error toast when the persona mention fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(api, 'postTicketComment').mockRejectedValue(new Error('nope'));
      render(<SmartSessionButton sessions={[]} ticketId="t1" />);
      await openDropdown();

      await act(async () => {
        fireEvent.click(screen.getByText('The Catalyst'));
      });

      expect(messages()).toContain('Échec du lancement du persona "The Catalyst"');
      expect(toastTypeFor('Échec du lancement du persona "The Catalyst"')).toBe('error');
      expect(consoleError).toHaveBeenCalled();
    });
  });
});

describe('SmartSessionButton — launcher panel', () => {
  beforeEach(() => {
    useSkillStore.setState({ skills: [skill] });
    useWorkflowTemplateStore.setState({ templates: [template], refresh: vi.fn().mockResolvedValue(undefined) });
    usePanelStore.setState({ panels: [panel], loaded: true, loadPanels: vi.fn().mockResolvedValue(undefined) });
    useAgentPersonaStore.setState({ personas: [persona], loaded: true, loadPersonas: vi.fn().mockResolvedValue(undefined) });
  });

  it('shows a filter chip per type with the count of enabled items, "Tous" being the sum', async () => {
    render(<SmartSessionButton sessions={[]} ticketId="t1" onExecuteSkill={vi.fn()} />);
    await openDropdown();

    // 1 skill + 1 workflow + 1 persona + 1 panel = 4
    expect(screen.getByRole('button', { name: 'Tous 4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skills 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Workflows 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Personas 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Panels 1' })).toBeTruthy();
  });

  it('filters the visible items to the active chip type', async () => {
    render(<SmartSessionButton sessions={[]} ticketId="t1" onExecuteSkill={vi.fn()} />);
    await openDropdown();

    // All types visible under "Tous"
    expect(screen.getByText('Prepare')).toBeTruthy();
    expect(screen.getByText('The Catalyst')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Panels 1' }));
    });

    // Only panels remain
    expect(screen.queryByText('Prepare')).toBeNull();
    expect(screen.queryByText('The Catalyst')).toBeNull();
    expect(screen.getByText('Archi Committee')).toBeTruthy();
  });

  it('renders a Fréquents section fed by the run stats, without personas', async () => {
    useFrequentLaunchStore.setState({
      stats: {
        skillLeaderboard: [{ skillId: 's1', skillName: 'prepare', skillDisplayName: 'Prepare', executionCount: 7, completedCount: 7, failedCount: 0 }],
        workflowLeaderboard: [{ workflowId: 'w1', workflowName: 'deploy', workflowDisplayName: 'Deploy', executionCount: 12, completedCount: 12, failedCount: 0, avgDurationMs: null }],
        panelLeaderboard: [],
      },
      loadedAt: Date.now(),
      loading: false,
      load: vi.fn().mockResolvedValue(undefined),
    });
    render(<SmartSessionButton sessions={[]} ticketId="t1" onExecuteSkill={vi.fn()} />);
    await openDropdown();

    expect(screen.getByText('Fréquents')).toBeTruthy();
  });

  it('hides the Fréquents section once a search query is typed', async () => {
    useFrequentLaunchStore.setState({
      stats: {
        skillLeaderboard: [{ skillId: 's1', skillName: 'prepare', skillDisplayName: 'Prepare', executionCount: 7, completedCount: 7, failedCount: 0 }],
        workflowLeaderboard: [],
        panelLeaderboard: [],
      },
      loadedAt: Date.now(),
      loading: false,
      load: vi.fn().mockResolvedValue(undefined),
    });
    render(<SmartSessionButton sessions={[]} ticketId="t1" onExecuteSkill={vi.fn()} />);
    await openDropdown();

    expect(screen.getByText('Fréquents')).toBeTruthy();

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/Filtrer/), { target: { value: 'prep' } });
    });

    expect(screen.queryByText('Fréquents')).toBeNull();
  });

  it('launches the highlighted item from the keyboard (ArrowDown then Enter)', async () => {
    // Only a skill present, so the first navigable row is unambiguous.
    useWorkflowTemplateStore.setState({ templates: [], refresh: vi.fn().mockResolvedValue(undefined) });
    usePanelStore.setState({ panels: [], loaded: true, loadPanels: vi.fn().mockResolvedValue(undefined) });
    useAgentPersonaStore.setState({ personas: [], loaded: true, loadPersonas: vi.fn().mockResolvedValue(undefined) });
    const onExecuteSkill = vi.fn().mockResolvedValue(undefined);
    render(<SmartSessionButton sessions={[]} ticketId="t1" onExecuteSkill={onExecuteSkill} />);
    await openDropdown();

    const input = screen.getByPlaceholderText(/Filtrer/);
    // Separate acts so the highlight state re-renders between keystrokes, as it
    // would between two real key presses.
    await act(async () => {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(onExecuteSkill).toHaveBeenCalledWith('s1');
  });

  it('does not render chips or asset lists without a ticketId', async () => {
    render(<SmartSessionButton sessions={[]} onExecuteSkill={vi.fn()} alwaysShowMenu />);
    await openDropdown();

    expect(screen.queryByRole('button', { name: /^Tous/ })).toBeNull();
    expect(screen.queryByText('Prepare')).toBeNull();
    expect(screen.queryByText('Archi Committee')).toBeNull();
    // Sessions creation is still available.
    expect(screen.getByText('New session')).toBeTruthy();
  });
});
