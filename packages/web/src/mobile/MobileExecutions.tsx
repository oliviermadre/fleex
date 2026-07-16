import { useMemo, useState } from 'react';
import type { AgentExecution } from '@fleex/shared';
import { useAgentEventStore } from '../stores/agentEventStore';
import { useAgentPersonaStore } from '../stores/agentPersonaStore';
import { cancelExecution } from '../services/api';
import { AgentEventStream } from '../components/main-panel/AgentEventStream';
import { tint, tintSolid } from '../lib/tints';

const EMPTY_EXECUTIONS: AgentExecution[] = [];

const STATUS_BADGE: Record<AgentExecution['status'], string> = {
  running: tint('yellow'),
  completed: tint('green'),
  failed: tint('red'),
  interrupted: tint('gray'),
};

function formatDuration(exec: AgentExecution): string {
  const end = exec.completedAt ? new Date(exec.completedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - new Date(exec.startedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}min${String(seconds % 60).padStart(2, '0')}`;
}

/** SDK agent runs of a ticket: history list + live full-screen event stream. */
export function MobileExecutions({ ticketId }: { ticketId: string }) {
  const executions = useAgentEventStore((s) => s.executionsByTicket[ticketId] ?? EMPTY_EXECUTIONS);
  const personas = useAgentPersonaStore((s) => s.personas);
  const [openExecId, setOpenExecId] = useState<string | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);

  const sorted = useMemo(
    () =>
      [...executions].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      ),
    [executions],
  );

  const personaName = (personaId: string) => {
    const p = personas.find((x) => x.id === personaId);
    return p?.displayName || p?.name || 'Agent';
  };

  const openExec = openExecId ? executions.find((e) => e.id === openExecId) : null;

  const handleKill = async () => {
    if (!openExec) return;
    if (!confirmKill) {
      setConfirmKill(true);
      setTimeout(() => setConfirmKill(false), 2000);
      return;
    }
    setConfirmKill(false);
    try {
      await cancelExecution(openExec.id);
    } catch {
      // execution may already be finished
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {sorted.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--theme-text-faint)]">
          Aucune exécution — mentionne un agent dans la conversation pour en lancer une.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((exec) => (
            <button
              key={exec.id}
              onClick={() => setOpenExecId(exec.id)}
              className="flex items-center gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] p-3 text-left active:bg-[var(--theme-bg-hover)]"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--theme-text-primary)]">
                  {personaName(exec.personaId)}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--theme-text-faint)]">
                  {new Date(exec.startedAt).toLocaleString('fr-FR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' · '}
                  {formatDuration(exec)}
                  {exec.model ? ` · ${exec.model}` : ''}
                  {exec.costUsd != null ? ` · $${exec.costUsd.toFixed(3)}` : ''}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[exec.status]}`}
              >
                {exec.status === 'running' ? '● live' : exec.status}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Full-screen live event stream */}
      {openExec && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[var(--theme-bg-base)]">
          <header
            className="flex shrink-0 items-center gap-2 border-b border-[var(--theme-border)] px-2 py-2"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
          >
            <button
              onClick={() => setOpenExecId(null)}
              className="shrink-0 rounded-md px-2 py-1.5 text-xl leading-none text-[var(--theme-text-muted)]"
              aria-label="Fermer"
            >
              ‹
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">
                {personaName(openExec.personaId)}
              </p>
              <p className="truncate font-mono text-[10px] text-[var(--theme-text-faint)]">
                {openExec.id.slice(0, 8)} · {openExec.status}
              </p>
            </div>
            {openExec.status === 'running' && (
              <button
                onClick={handleKill}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  confirmKill ? `${tintSolid('red')} text-white` : tint('red')
                }`}
              >
                {confirmKill ? 'Confirmer ?' : 'Stopper'}
              </button>
            )}
          </header>
          <div className="flex min-h-0 flex-1 flex-col" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <AgentEventStream executionId={openExec.id} />
          </div>
        </div>
      )}
    </div>
  );
}
