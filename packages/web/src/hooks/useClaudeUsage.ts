import { useState, useEffect, useRef, useCallback } from 'react';
import type { ClaudeUsage, DashboardMessage } from '@fleex/shared';
import { fetchClaudeUsage } from '../services/api';
import { dashboardWs } from '../services/websocket';

export function useClaudeUsage() {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const load = useCallback(async (force = false) => {
    const data = await fetchClaudeUsage(force);
    if (mountedRef.current) {
      setUsage(data);
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch
    load();

    // Listen for server-pushed usage updates via dashboard WS
    const handleMessage = (data: ArrayBuffer) => {
      try {
        const text = new TextDecoder().decode(data);
        const msg = JSON.parse(text) as DashboardMessage;
        if (msg.type === 'usage:updated' && mountedRef.current) {
          setUsage(msg.data);
          setLoading(false);
        }
      } catch {
        // ignore non-JSON frames
      }
    };

    // Re-fetch on reconnect
    const handleOpen = () => { load(); };

    const unsubMessage = dashboardWs.onMessage(handleMessage);
    const unsubOpen = dashboardWs.onOpen(handleOpen);

    return () => {
      mountedRef.current = false;
      unsubMessage();
      unsubOpen();
    };
  }, [load]);

  return { usage, loading, refresh };
}
