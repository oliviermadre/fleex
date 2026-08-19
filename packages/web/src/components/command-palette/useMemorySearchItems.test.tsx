import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMemorySearchItems } from './useMemorySearchItems';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * The palette is where the two intents collide: the same keystrokes that navigate
 * to a ticket are often a question about it. These pin which of the two the hook
 * offers, and when.
 */
function setMemory(engine: 'legacy' | 'semantic', features?: Record<string, boolean>) {
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      memoryEngine: engine,
      ...(features ? { memoryFeatures: features } : {}),
    },
  });
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  setMemory('semantic', {});
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ query: 'x', results: [] }),
  } as Response)) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setMemory('legacy', {});
});

describe('useMemorySearchItems', () => {
  it('offers asking even when a command already matched', async () => {
    // The regression this pins: gating the ask entry on "nothing matched" removed
    // it exactly when a question was most plausible.
    const { result } = renderHook(() => useMemorySearchItems('routines', true));

    await waitFor(() => {
      expect(result.current.map((i) => i.id)).toContain('memory:ask');
    });
  });

  it('offers asking when nothing matched either', async () => {
    const { result } = renderHook(() => useMemorySearchItems('routines', false));
    await waitFor(() => {
      expect(result.current.map((i) => i.id)).toContain('memory:ask');
    });
  });

  it('keeps the ask entry last, so it never pushes a command down', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        query: 'x',
        results: [{ sourceKind: 'ticket', sourceId: 't1', title: 'A ticket', content: 'body', score: 0.8 }],
      }),
    } as Response)) as unknown as typeof fetch;

    const { result } = renderHook(() => useMemorySearchItems('routines', false));
    await waitFor(() => expect(result.current.length).toBe(2));
    expect(result.current[result.current.length - 1]!.id).toBe('memory:ask');
  });

  it('offers nothing under the legacy engine', () => {
    setMemory('legacy', {});
    const { result } = renderHook(() => useMemorySearchItems('routines', false));
    expect(result.current).toEqual([]);
  });

  it('offers nothing when asking is switched off', async () => {
    setMemory('semantic', { ask: false });
    const { result } = renderHook(() => useMemorySearchItems('routines', true));
    // Search excerpts are suppressed by the local match, and asking by its switch.
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it('says nothing for a query too short to mean anything', () => {
    const { result } = renderHook(() => useMemorySearchItems('ro', false));
    expect(result.current).toEqual([]);
  });
});
