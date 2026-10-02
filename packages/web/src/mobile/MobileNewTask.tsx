import { useEffect, useRef } from 'react';
import { NewTask } from '../components/work/new/NewTask';
import { useWorkStore } from '../stores/workStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useMobileNavStore } from './mobileNavStore';

/**
 * The desktop new-task flow (import from GitHub / Slack, repos and base
 * branches, epics, type, priority, Start) in a full-screen page. It is the very
 * same component, driven by the same workStore draft — the flow signals its end
 * by leaving `view: 'new'`, and a created ticket shows up as a new selection.
 */
export function MobileNewTask({ onClose }: { onClose: () => void }) {
  const view = useWorkStore((s) => s.view);
  const selectedTicketId = useWorkStore((s) => s.selectedTicketId);
  const openTicket = useMobileNavStore((s) => s.openTicket);
  const initialSelection = useRef(useWorkStore.getState().selectedTicketId);

  useEffect(() => {
    useWorkStore.getState().setView('new');
    void useRepositoryStore.getState().fetchRepositories();
  }, []);

  // Cancel and Start both leave 'new'; only Start changes the selected ticket.
  useEffect(() => {
    if (view === 'new') return;
    onClose();
    if (selectedTicketId && selectedTicketId !== initialSelection.current) {
      openTicket(selectedTicketId, 'conversation');
    }
  }, [view, selectedTicketId, onClose, openTicket]);

  return (
    <div
      className="fixed inset-0 z-[45] flex flex-col bg-[var(--theme-bg-base)]"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <header className="relative flex h-12 shrink-0 items-center border-b border-[var(--theme-border)] px-2">
        <button
          type="button"
          onClick={() => useWorkStore.getState().setView('task')}
          className="flex min-h-11 items-center px-2 text-[15px] text-[var(--theme-accent)]"
        >
          ‹ Annuler
        </button>
        <h1 className="pointer-events-none absolute inset-x-0 text-center text-base font-semibold">Nouvelle tâche</h1>
      </header>
      {/* Same screens as desktop; only the card padding is tightened for a phone. */}
      <div
        className="flex min-h-0 flex-1 flex-col [&>div]:!p-3"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <NewTask enterStarts={false} />
      </div>
    </div>
  );
}
