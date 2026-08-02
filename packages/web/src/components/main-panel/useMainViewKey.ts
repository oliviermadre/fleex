import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useSkillStore } from '../../stores/skillStore';
import { usePanelStore } from '../../stores/panelStore';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';

/**
 * A stable identity for whatever `MainPanel` is currently rendering.
 *
 * Used as the `key` of the main-view error boundary. React remounts a
 * component when its key changes, which is what makes a caught error clear on
 * navigation — without it, crashing on ticket A would leave the crash screen
 * up when the user opens the healthy ticket B, and only a page reload would
 * recover.
 *
 * This intentionally does NOT mirror `MainPanel`'s branching logic; it just
 * concatenates the active panel with the selected entity.
 *
 * When in doubt, include the id. A key that is too *fine* only costs an extra
 * remount; a key that is too *coarse* leaves a crash screen up over a view the
 * user has already navigated away from — the exact bug this hook exists to
 * prevent.
 */
export function useMainViewKey(): string {
  const activePanel = useUIStore((s) => s.activePanel);
  const selectedRepoKey = useUIStore((s) => s.selectedRepoKey);
  const selectedAgentWorktreeTicketId = useUIStore((s) => s.selectedAgentWorktreeTicketId);
  const sessionTicketId = useSessionStore((s) => s.selectedTicketId);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const selectedGroupId = useSessionStore((s) => s.selectedGroupId);
  const selectedTicketId = useTicketStore((s) => s.selectedTicketId);
  const selectedSkillId = useSkillStore((s) => s.selectedSkillId);
  const selectedPanelId = usePanelStore((s) => s.selectedPanelId);
  const selectedScratchpadKey = useScratchpadStore((s) => s.selectedScratchpadKey);
  const selectedWorkflowId = useWorkflowTemplateStore((s) => s.selectedWorkflowId);

  switch (activePanel) {
    case 'tickets':
      return selectedTicketId ? `tickets:${selectedTicketId}` : 'tickets:board';

    case 'repositories':
      return selectedRepoKey ? `repositories:${selectedRepoKey}` : 'repositories:empty';

    case 'scratchpads':
      return selectedScratchpadKey ? `scratchpads:${selectedScratchpadKey}` : 'scratchpads:empty';

    case 'agents':
      // Mirrors MainPanel's precedence: panel → skill → workflow → persona list.
      if (selectedPanelId) return `agents:panel:${selectedPanelId}`;
      if (selectedSkillId) return `agents:skill:${selectedSkillId}`;
      if (selectedWorkflowId) return `agents:workflow:${selectedWorkflowId}`;
      return 'agents:personas';

    // `cluster` matches no branch in MainPanel, so it falls through to the same
    // session/group/empty rendering as `sessions`. Keyed identically here, or a
    // crash on one group would persist after switching to another.
    case 'sessions':
    case 'cluster': {
      if (activePanel === 'sessions' && selectedAgentWorktreeTicketId) {
        return `sessions:agent:${selectedAgentWorktreeTicketId}`;
      }
      if (activePanel === 'sessions' && sessionTicketId) {
        return `sessions:ticket:${sessionTicketId}`;
      }
      if (selectedGroupId) return `${activePanel}:group:${selectedGroupId}`;
      return selectedSessionId ? `${activePanel}:${selectedSessionId}` : `${activePanel}:empty`;
    }

    default:
      // dashboard, list-focus, assistant, settings, documents, execution-log,
      // analytics, claude-config — single-view panels with no sub-selection
      // that can crash independently.
      return activePanel;
  }
}
