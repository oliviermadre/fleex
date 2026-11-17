import { useEffect, useState } from 'react';
import { factoryApi } from './factoryApi';
import { useFactoryStore } from './factoryStore';

/** A station's run, as the ticket timeline needs it: the execution it started, the station's name, what it runs, what it concluded. */
export interface StationRun { executionId: string | null; station: string; executor: string; outcome: string | null }

const NONE: readonly StationRun[] = [];

/**
 * The runs Factory stations started on a ticket, for what shows a ticket's history outside the floor (the Work
 * view's timeline): without them an execution a station started has nothing to say where it comes from. Empty while
 * the Factory is off, and for a ticket no station ever ran on. Read again when `stamp` changes (the caller passes
 * something that moves when the ticket's executions do).
 */
export function useFactoryStationRuns(ticketId: string, stamp: unknown): readonly StationRun[] {
  const enabled = useFactoryStore((s) => s.enabled);
  const [runs, setRuns] = useState<{ ticketId: string; list: readonly StationRun[] }>({ ticketId, list: NONE });
  useEffect(() => {
    if (!enabled || !ticketId) return;
    let live = true;
    factoryApi.runs(ticketId)
      .then((rows) => { if (live) setRuns({ ticketId, list: rows.filter((r) => r.executionId).map((r) => ({ executionId: r.executionId, station: r.machineName, executor: r.executor, outcome: r.outcome })) }); })
      .catch(() => { /* the timeline then names these runs as it did without the Factory */ });
    return () => { live = false; };
  }, [enabled, ticketId, stamp]);
  /* never the runs of the ticket shown before, while this one's are on their way */
  return enabled && runs.ticketId === ticketId ? runs.list : NONE;
}
