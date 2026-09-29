import { useUIStore } from '../../stores/uiStore';
import { SettingsPanel } from '../settings/SettingsPanel';
import { RepositoryDashboard } from '../repository-dashboard/RepositoryDashboard';
import { RepositoryEmptyState } from '../repository-dashboard/RepositoryEmptyState';
import { ClaudeConfigEditor } from '../claude-config/ClaudeConfigEditor';
import { ScratchpadMainView } from '../scratchpad/ScratchpadMainView';
import { ScratchpadEmptyState } from '../scratchpad/ScratchpadEmptyState';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { KanbanBoard } from '../tickets/KanbanBoard';
import { TicketDetail } from '../tickets/TicketDetail';
import { useTicketStore } from '../../stores/ticketStore';
import { AgentPersonaView } from '../agents/AgentPersonaView';
import { SkillEditor } from '../agents/SkillEditor';
import { PanelDetailView } from '../agents/PanelDetailView';
import { WorkflowEditorView } from '../workflows/WorkflowEditorView';
import { useSkillStore } from '../../stores/skillStore';
import { usePanelStore } from '../../stores/panelStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useNavigate } from 'react-router-dom';
import { AnalyticsPanel } from '../analytics/AnalyticsPanel';
import { FocusView } from '../focus/FocusView';
import { ExecutionLogPage } from '../execution-log/ExecutionLogPage';
import { RoutinesPage } from '../routines/RoutinesPage';
import { DocumentsPage } from '../documents/DocumentsPage';
import { AssistantConversation } from '../assistant/AssistantConversation';
import { WorkView } from '../work/WorkView';

export function MainPanel() {
  const activePanel = useUIStore((s) => s.activePanel);
  const selectedRepoKey = useUIStore((s) => s.selectedRepoKey);
  const selectedScratchpadKey = useScratchpadStore((s) => s.selectedScratchpadKey);
  const selectedTicketId = useTicketStore((s) => s.selectedTicketId);
  const selectedSkillId = useSkillStore((s) => s.selectedSkillId);
  const selectedPanelId = usePanelStore((s) => s.selectedPanelId);
  const selectedWorkflowId = useWorkflowTemplateStore((s) => s.selectedWorkflowId);
  const workflowTemplates = useWorkflowTemplateStore((s) => s.templates);
  const selectWorkflow = useWorkflowTemplateStore((s) => s.selectWorkflow);
  const navigate = useNavigate();

  if (activePanel === 'focus') {
    return <FocusView />;
  }

  if (activePanel === 'work') {
    return <WorkView />;
  }

  if (activePanel === 'assistant') {
    return <AssistantConversation />;
  }

  if (activePanel === 'settings') {
    return <SettingsPanel />;
  }

  if (activePanel === 'documents') {
    return <DocumentsPage />;
  }

  if (activePanel === 'execution-log') {
    return <ExecutionLogPage />;
  }

  if (activePanel === 'routines') {
    return <RoutinesPage />;
  }

  if (activePanel === 'analytics') {
    return <AnalyticsPanel />;
  }

  if (activePanel === 'claude-config') {
    return <ClaudeConfigEditor />;
  }

  if (activePanel === 'scratchpads') {
    if (!selectedScratchpadKey) return <ScratchpadEmptyState />;
    return <ScratchpadMainView scratchpadKey={selectedScratchpadKey} />;
  }

  if (activePanel === 'agents') {
    if (selectedPanelId) {
      return <PanelDetailView />;
    }
    if (selectedSkillId) {
      return <SkillEditor />;
    }
    if (selectedWorkflowId) {
      const template = workflowTemplates.find((t) => t.id === selectedWorkflowId);
      if (template) {
        return (
          <WorkflowEditorView
            template={template}
            onBack={() => {
              selectWorkflow(null);
              navigate('/agents', { replace: true });
            }}
          />
        );
      }
    }
    return <AgentPersonaView />;
  }

  if (activePanel === 'tickets') {
    if (selectedTicketId) {
      return <TicketDetail ticketId={selectedTicketId} />;
    }
    return <KanbanBoard />;
  }

  if (activePanel === 'repositories') {
    if (!selectedRepoKey) {
      return <RepositoryEmptyState />;
    }
    return <RepositoryDashboard repoKey={selectedRepoKey} />;
  }

  // No dedicated view (e.g. 'cluster', a placeholder panel): render nothing
  // rather than a leftover of the retired Sessions view.
  return null;
}
