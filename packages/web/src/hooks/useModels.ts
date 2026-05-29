import { useEffect, useState } from 'react';
import { FALLBACK_MODELS, type ModelOption } from '@fleex/shared';
import { fetchModels } from '../services/api';

/**
 * Session-scoped cache so dropdowns across the app don't refetch.
 * The server has its own TTL (1h); the frontend just caches per session.
 */
let cachedModels: ModelOption[] | null = null;
let cachedFallback = false;
let inflight: Promise<{ models: ModelOption[]; fallback: boolean }> | null = null;

async function loadModels(): Promise<{ models: ModelOption[]; fallback: boolean }> {
  if (cachedModels) return { models: cachedModels, fallback: cachedFallback };
  if (!inflight) {
    inflight = fetchModels()
      .then((res) => {
        cachedModels = res.models.length > 0 ? res.models : FALLBACK_MODELS;
        cachedFallback = res.fallback === true;
        return { models: cachedModels, fallback: cachedFallback };
      })
      .catch(() => {
        cachedModels = FALLBACK_MODELS;
        cachedFallback = true;
        return { models: cachedModels, fallback: true };
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export interface UseModelsResult {
  models: ModelOption[];
  isFallback: boolean;
  isLoading: boolean;
}

export function useModels(): UseModelsResult {
  const [state, setState] = useState<UseModelsResult>(() => ({
    models: cachedModels ?? FALLBACK_MODELS,
    isFallback: cachedFallback,
    isLoading: cachedModels === null,
  }));

  useEffect(() => {
    let cancelled = false;
    if (cachedModels !== null) return;
    loadModels().then((res) => {
      if (cancelled) return;
      setState({ models: res.models, isFallback: res.fallback, isLoading: false });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
