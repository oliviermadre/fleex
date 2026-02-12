import { useState, useEffect, useRef } from 'react';
import type { ClaudeUsage } from '@asm/shared';
import { CLAUDE_USAGE_CACHE_TTL_MS } from '@asm/shared';
import { fetchClaudeUsage } from '../services/api';

export function useClaudeUsage() {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function load() {
      const data = await fetchClaudeUsage();
      if (mountedRef.current) {
        setUsage(data);
        setLoading(false);
      }
    }

    load();

    const interval = setInterval(async () => {
      const data = await fetchClaudeUsage();
      if (mountedRef.current) {
        setUsage(data);
      }
    }, CLAUDE_USAGE_CACHE_TTL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  return { usage, loading };
}
