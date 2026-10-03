import { useEffect } from 'react';
import type { PrCiSummary } from '@fleex/shared';
import { usePrCiStore } from '../stores/prCiStore';

/**
 * Watch one PR's CI summary in the shared store. Pass null to opt out (a chip
 * with no CI segment). Every chip for the same ref shares the same data.
 */
export function usePrCi(ref: string | null): { summary?: PrCiSummary; error?: string } {
  const subscribe = usePrCiStore((s) => s.subscribe);
  const summary = usePrCiStore((s) => (ref ? s.summaries[ref] : undefined));
  const error = usePrCiStore((s) => (ref ? s.errors[ref] : undefined));

  useEffect(() => {
    if (!ref) return;
    return subscribe([ref]);
  }, [ref, subscribe]);

  return { summary, error };
}
