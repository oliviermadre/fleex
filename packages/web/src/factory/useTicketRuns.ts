import { useEffect, useState } from 'react';
import * as api from '../services/api';
import { factoryApi } from './factoryApi';
import type { FactoryRun, FactoryTicket } from './types';

export interface TicketRuns {
  /** The runs that started an execution, oldest first: the ones there is a log to show for. */
  list: readonly FactoryRun[];
  /** The run the ticket is on (`ft.runId`) when it has a log or is starting one; else the last one with a log. */
  current: FactoryRun | null;
  /** What each execution cost so far, by execution id. */
  cost: Readonly<Record<string, number>>;
  /** Whether the first answer came back. */
  loaded: boolean;
}

const EMPTY: TicketRuns = { list: [], current: null, cost: {}, loaded: false };

/**
 * The runs Factory stations started on a ticket, for the floor's peek card. Read again when the snapshot moves the
 * ticket on (another run, another phase), and on every snapshot while the current run is running without its
 * execution id yet: the runner only sets it once the agent has started.
 */
export function useTicketRuns(ft: FactoryTicket | null, serverTime: string | undefined): TicketRuns {
  const ticketId = ft?.ticketId ?? '';
  const [state, setState] = useState<{ ticketId: string; runs: TicketRuns }>({ ticketId, runs: EMPTY });
  const mine = state.ticketId === ticketId ? state.runs : EMPTY;
  const waiting = ft?.phase === 'running' && !!ft.runId && !(mine.current?.id === ft.runId && mine.current.executionId);
  const stamp = `${ft?.runId ?? ''}:${ft?.phase ?? ''}:${waiting ? serverTime ?? '' : ''}`;

  useEffect(() => {
    if (!ticketId) return;
    let live = true;
    factoryApi.runs(ticketId)
      .then(async (rows) => {
        const list = rows.filter((r) => r.executionId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
        const own = ft?.runId ? rows.find((r) => r.id === ft.runId) ?? null : null;
        /* a gate opens a run of its own with no execution: the ticket's run then has no log, show the last one that has */
        const current = (own && (own.executionId || own.status === 'running') ? own : null) ?? list[list.length - 1] ?? null;
        let cost: Record<string, number> = {};
        if (list.length) {
          try { cost = Object.fromEntries((await api.fetchExecutionsForTicket(ticketId)).map((e) => [e.id, e.costUsd ?? 0])); } catch { /* no cost then */ }
        }
        if (live) setState({ ticketId, runs: { list, current, cost, loaded: true } });
      })
      .catch(() => { if (live) setState((s) => (s.ticketId === ticketId ? { ticketId, runs: { ...s.runs, loaded: true } } : { ticketId, runs: { ...EMPTY, loaded: true } })); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the stamp carries what moves the runs
  }, [ticketId, stamp]);

  return mine;
}
