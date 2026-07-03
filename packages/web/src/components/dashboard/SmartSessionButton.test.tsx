import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import type { Skill, WorkflowTemplate } from '@fleex/shared';
import { SmartSessionButton } from './SmartSessionButton';
import { useToastStore } from '../../stores/toastStore';
import { useSkillStore } from '../../stores/skillStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';

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
});
