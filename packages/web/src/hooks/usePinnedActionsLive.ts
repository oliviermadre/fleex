import { useEffect } from 'react';
import type { PinnedStatusWsMessage, WorktreeActionsWsMessage } from '@fleex/shared';
import { appWs } from '../services/websocket';
import { usePinnedActionsStore } from '../stores/pinnedActionsStore';
import { useWorktreeActionsStore } from '../stores/worktreeActionsStore';

/**
 * Keeps the action buttons' live state current: probe results and run
 * outcomes arrive on the `pinned-status` channel. The initial fetch covers the
 * snapshot the server sent on connect before this handler was registered.
 */
export function usePinnedActionsLive() {
  const loadStatuses = usePinnedActionsStore((s) => s.loadStatuses);
  const handleWsMessage = usePinnedActionsStore((s) => s.handleWsMessage);
  const reconcileRuns = usePinnedActionsStore((s) => s.reconcileRuns);
  const loadCapabilities = usePinnedActionsStore((s) => s.loadCapabilities);
  const reloadWorktrees = useWorktreeActionsStore((s) => s.reloadAll);

  useEffect(() => {
    void loadStatuses();
    void loadCapabilities();
  }, [loadStatuses, loadCapabilities]);

  // A run that finished while the socket was down never sends its `finished`;
  // a reopen may also mean the gateway restarted on a build with new capabilities.
  // Worktree server states pushed while down are missed too: re-fetch them.
  useEffect(() => appWs.onOpen(() => {
    void reconcileRuns();
    void loadCapabilities();
    void reloadWorktrees();
  }), [reconcileRuns, loadCapabilities, reloadWorktrees]);

  useEffect(() => appWs.onChannel('pinned-status', (msg) => handleWsMessage(msg as PinnedStatusWsMessage)), [handleWsMessage]);

  // Worktree dev-server states share the channel.
  const handleWorktreeMessage = useWorktreeActionsStore((s) => s.handleWsMessage);
  useEffect(() => appWs.onChannel('pinned-status', (msg) => handleWorktreeMessage(msg as WorktreeActionsWsMessage)), [handleWorktreeMessage]);
}
