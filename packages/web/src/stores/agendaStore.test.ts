import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaResponse } from '@fleex/shared';

vi.mock('../services/api', () => ({ fetchAgenda: vi.fn() }));
vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import * as api from '../services/api';
import { useAgendaStore } from './agendaStore';

const resp = (tag: string) => ({ from: tag, to: '', generatedAt: '', items: [], routines: [], truncated: [], epics: [], errors: {} }) as unknown as AgendaResponse;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('agendaStore.refresh', () => {
  beforeEach(() => vi.mocked(api.fetchAgenda).mockReset());

  // Drag & drop drops its optimistic override right after `await refresh()`. If a
  // websocket refetch superseded that refresh, resolving early uncovered the stale
  // data: the dropped event jumped back to its old slot until the newer fetch landed.
  it('a superseded refresh resolves only once the newest data is on screen', async () => {
    const first = deferred<AgendaResponse>();
    const second = deferred<AgendaResponse>();
    vi.mocked(api.fetchAgenda).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    let firstDone = false;
    const p1 = useAgendaStore.getState().refresh().then(() => { firstDone = true; });
    const p2 = useAgendaStore.getState().refresh();

    first.resolve(resp('stale'));
    await new Promise((r) => setTimeout(r, 0));
    expect(firstDone).toBe(false);
    expect(useAgendaStore.getState().data?.from).not.toBe('stale');

    second.resolve(resp('fresh'));
    await Promise.all([p1, p2]);
    expect(firstDone).toBe(true);
    expect(useAgendaStore.getState().data?.from).toBe('fresh');
  });
});
