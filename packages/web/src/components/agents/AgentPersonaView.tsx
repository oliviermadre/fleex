import { useNavigate } from 'react-router-dom';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { AgentEmptyState } from './AgentEmptyState';
import { AgentConfigTab } from './AgentConfigTab';
import { AgentMarkdownTab } from './AgentMarkdownTab';
import { AgentEventsTab } from './AgentEventsTab';
import { ModelBadge } from './ModelBadge';
import { cn } from '../../lib/cn';

const TABS = [
  { key: 'config' as const, label: 'Config' },
  { key: 'soul' as const, label: 'Soul' },
  { key: 'identity' as const, label: 'Identity' },
  { key: 'memory' as const, label: 'Memory' },
  { key: 'events' as const, label: 'Events' },
];

export function AgentPersonaView() {
  const navigate = useNavigate();
  const personas = useAgentPersonaStore((s) => s.personas);
  const selectedPersonaId = useAgentPersonaStore((s) => s.selectedPersonaId);
  const activeTab = useAgentPersonaStore((s) => s.activeTab);
  const executeAgent = useAgentPersonaStore((s) => s.executeAgent);
  const executionStatuses = useAgentPersonaStore((s) => s.executionStatuses);

  const persona = personas.find((p) => p.id === selectedPersonaId);
  if (!persona) return <AgentEmptyState />;

  const status = executionStatuses[persona.id];
  const isRunning = status?.running ?? false;

  const handlePlay = async () => {
    try {
      const result = await executeAgent(persona.id);
      if (result.status === 'no_work') {
        console.log('No pending work for this agent');
      }
    } catch (err) {
      console.error('Agent execution failed:', err);
    }
  };

  const handleTabClick = (tab: typeof TABS[number]['key']) => {
    if (tab === 'config') {
      navigate(`/agents/${persona.id}`, { replace: true });
    } else {
      navigate(`/agents/${persona.id}/${tab}`, { replace: true });
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-primary)]">
      {/* Header — matches SessionHeader pattern */}
      <div className="flex items-center gap-3 border-b border-[var(--theme-border)] px-3" style={{ height: 'var(--header-height)' }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--theme-text-secondary)]">
            <path d="M12 8V4H8" />
            <rect width="16" height="12" x="4" y="8" rx="2" />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </svg>
          <span className="text-sm font-semibold font-mono text-[var(--theme-text-primary)] truncate">
            {persona.displayName}
          </span>
        </div>

        <ModelBadge modelId={persona.model} size="normal" />

        {isRunning && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-[10px] text-yellow-400">Running</span>
          </div>
        )}

        <span className="shrink-0 truncate text-xs text-[var(--theme-text-faint)]">
          @agent:{persona.name}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handlePlay}
            disabled={isRunning}
            className={cn(
              'flex h-6 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors',
              isRunning
                ? 'cursor-not-allowed text-[var(--theme-text-faint)]'
                : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]',
            )}
            title="Run agent on pending mentions"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
              <path d="M4 2l10 6-10 6V2z" />
            </svg>
            Play
          </button>
        </div>
      </div>

      {/* Tab bar — matches SessionTabs pattern */}
      <div className="flex items-center gap-0 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 overflow-x-auto">
        {TABS.map((tab) => (
          <div
            key={tab.key}
            role="button"
            onClick={() => handleTabClick(tab.key)}
            className={cn(
              'relative flex items-center px-3 py-2 text-xs whitespace-nowrap transition-colors',
              activeTab === tab.key
                ? 'text-[var(--theme-text-primary)]'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
            )}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--theme-accent)]" />
            )}
          </div>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeTab === 'config' && <AgentConfigTab persona={persona} />}
        {activeTab === 'soul' && <AgentMarkdownTab persona={persona} field="soulMd" />}
        {activeTab === 'identity' && <AgentMarkdownTab persona={persona} field="identityMd" />}
        {activeTab === 'memory' && <AgentMarkdownTab persona={persona} field="memoryMd" />}
        {activeTab === 'events' && <AgentEventsTab />}
      </div>
    </div>
  );
}
