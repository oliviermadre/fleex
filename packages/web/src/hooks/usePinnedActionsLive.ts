import { useEffect } from 'react';
import type { PinnedStatusWsMessage } from '@fleex/shared';
import { appWs } from '../services/websocket';
import { usePinnedActionsStore } from '../stores/pinnedActionsStore';

/**
 * Keeps the action buttons' live state current: probe results and run
 * outcomes arrive on the `pinned-status` channel. The initial fetch covers the
 * snapshot the server sent on connect before this handler was registered.
 */
export function usePinnedActionsLive() {
  const loadStatuses = usePinnedActionsStore((s) => s.loadStatuses);
  const handleWsMessage = usePinnedActionsStore((s) => s.handleWsMessage);

  useEffect(() => {
    void loadStatuses();
  }, [loadStatuses]);

  useEffect(() => appWs.onChannel('pinned-status', (msg) => handleWsMessage(msg as PinnedStatusWsMessage)), [handleWsMessage]);
}
