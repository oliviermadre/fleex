import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useUIStore } from '../../stores/uiStore';
import { CreateAgentModal } from './CreateAgentModal';
import { cn } from '../../lib/cn';

export function AgentListPanel() {
  const navigate = useNavigate();
  const personas = useAgentPersonaStore((s) => s.personas);
  const selectedPersonaId = useAgentPersonaStore((s) => s.selectedPersonaId);
  const executionStatuses = useAgentPersonaStore((s) => s.executionStatuses);
  const deletePersona = useAgentPersonaStore((s) => s.deletePersona);
  const toggleContentPanel = useUIStore((s) => s.toggleContentPanel);
  const [modalOpen, setModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  return (
    <div className="flex h-full flex-col">
      {/* Header — matches SidebarHeader / ScratchpadsContent pattern */}
      <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-4" style={{ height: 'var(--header-height)' }}>
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Agents</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setModalOpen(true)}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
            title="Create agent"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="8" y1="3" x2="8" y2="13" />
              <line x1="3" y1="8" x2="13" y2="8" />
            </svg>
          </button>
          <button
            onClick={toggleContentPanel}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
            title="Collapse panel"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
              <line x1="6" y1="1.5" x2="6" y2="14.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto pb-2">
        {personas.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-[var(--theme-text-muted)]">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--theme-text-faint)]">
              <path d="M12 8V4H8" />
              <rect width="16" height="12" x="4" y="8" rx="2" />
              <path d="M2 14h2" />
              <path d="M20 14h2" />
              <path d="M15 13v2" />
              <path d="M9 13v2" />
            </svg>
            <p className="text-xs">No agents yet</p>
            <button
              onClick={() => setModalOpen(true)}
              className="text-xs text-[var(--theme-accent)] hover:underline"
            >
              Create your first agent
            </button>
          </div>
        ) : (
          personas.map((persona) => {
            const isSelected = selectedPersonaId === persona.id;
            const status = executionStatuses[persona.id];
            const isRunning = status?.running ?? false;
            const hasPending = (status?.pendingMentions ?? 0) > 0;

            return (
              <button
                key={persona.id}
                className={cn(
                  'flex min-w-0 w-full items-center gap-3 py-2.5 pl-6 pr-3 text-left transition-colors border-l-2',
                  isSelected
                    ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
                    : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
                )}
                onClick={() => navigate(`/agents/${persona.id}`, { replace: true })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ id: persona.id, x: e.clientX, y: e.clientY });
                }}
              >
                {/* Status dot */}
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    isRunning
                      ? 'bg-yellow-400 animate-pulse'
                      : hasPending
                        ? 'bg-blue-400'
                        : 'bg-[var(--theme-text-faint)]',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">
                    {persona.displayName}
                  </div>
                  <div className="truncate text-xs text-[var(--theme-text-muted)]">
                    @agent:{persona.name}
                  </div>
                </div>
                <span className="shrink-0 rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--theme-text-muted)]">
                  {persona.model.replace('claude-', '').replace('-4-6', '').replace('-4-5', '')}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="flex w-full items-center gap-2 px-4 py-1.5 text-xs text-red-400 hover:bg-[var(--theme-bg-hover)]"
              onClick={() => {
                deletePersona(contextMenu.id);
                setContextMenu(null);
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}

      <CreateAgentModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
