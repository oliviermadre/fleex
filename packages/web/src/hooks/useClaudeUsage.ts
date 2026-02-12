import { useState, useEffect, useRef, useCallback } from 'react';
import type { ClaudeUsage } from '@asm/shared';
import { CLAUDE_USAGE_CACHE_TTL_MS } from '@asm/shared';
import { fetchClaudeUsage } from '../services/api';

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

    load();

    const interval = setInterval(load, CLAUDE_USAGE_CACHE_TTL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [load]);

  return { usage, loading, refresh };
}
