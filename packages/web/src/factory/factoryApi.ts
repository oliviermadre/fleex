import { API_URL } from '../lib/constants';
import { toast } from '../lib/toast';
import type { ItemSource } from './items';
import type { ItemFields } from './types';
import type { FactoryLayout, FactoryRun, FactorySettings, FactorySnapshot, FactoryStats, Target } from './types';

async function call<T>(path: string, init?: RequestInit, quiet = false): Promise<T> {
  const res = await fetch(`${API_URL}/factory${path}`, { ...init, headers: init?.body ? { 'Content-Type': 'application/json' } : undefined });
  if (!res.ok) {
    let message = res.statusText;
    try { message = ((await res.json()) as { message?: string }).message ?? message; } catch { /* not JSON */ }
    if (!quiet) toast.error(message);
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
const post = <T,>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const factoryApi = {
  status: () => call<{ supported: boolean; enabled: boolean }>('/status', undefined, true),
  state: () => call<FactorySnapshot>('/state', undefined, true),
  managed: () => call<{ ticketIds: string[] }>('/managed', undefined, true),
  ackNotice: () => post<FactorySnapshot>('/notice/ack'),
  setLayout: (layout: FactoryLayout) => call<FactorySnapshot>('/layout', { method: 'PUT', body: JSON.stringify({ layout }) }),
  setSettings: (settings: Partial<FactorySettings>) => call<FactorySnapshot>('/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  transfer: (ticketId: string, target: Target) => post<FactorySnapshot>(`/tickets/${ticketId}/transfer`, target),
  move: (ticketId: string, target: Target) => post<FactorySnapshot>(`/tickets/${ticketId}/move`, target),
  release: (ticketId: string) => post<FactorySnapshot>(`/tickets/${ticketId}/release`),
  resolve: (ticketId: string, outcome: string, reason = '') => post<FactorySnapshot>(`/tickets/${ticketId}/resolve`, { outcome, reason }),
  /** Take a ticket off its station's hands (a run in progress is stopped). */
  setAside: (ticketId: string) => post<FactorySnapshot>(`/tickets/${ticketId}/aside`),
  /** Put back a ticket that was set aside: with an outcome it leaves the station by that arm, without one the station runs again. */
  putBack: (ticketId: string, outcome?: string) => post<FactorySnapshot>(`/tickets/${ticketId}/put-back`, outcome ? { how: 'as', outcome } : { how: 'again' }),
  halt: (on: boolean) => post<FactorySnapshot>('/halt', { on }),
  power: (machineId: string, on: boolean) => post<FactorySnapshot>(`/machines/${machineId}/power`, { on }),
  retry: (ticketId: string) => post<FactorySnapshot>(`/tickets/${ticketId}/retry`),
  refreshTicket: (ticketId: string) => post<FactorySnapshot>(`/tickets/${ticketId}/refresh`),
  giveBack: (ticketId: string) => call<FactorySnapshot>(`/tickets/${ticketId}`, { method: 'DELETE' }),
  runs: (ticketId: string) => call<FactoryRun[]>(`/tickets/${ticketId}/runs`, undefined, true),
  machineRuns: (machineId: string, limit = 60) => call<FactoryRun[]>(`/runs?machineId=${encodeURIComponent(machineId)}&limit=${limit}`, undefined, true),
  /** A conversation moved in a source (made by hand until the sources are connected): a new item, or an update. */
  ingest: (item: { source: ItemSource; key: string; title: string; author?: string; excerpt?: string; url?: string | null; fields?: ItemFields }) =>
    post<{ itemId: string | null; status: 'new' | 'updated' | 'back' | 'dropped'; snapshot: FactorySnapshot }>('/items', item),
  /** What stations did with an item and what they answered, oldest first. */
  itemRuns: (itemId: string) => call<FactoryRun[]>(`/items/${itemId}/runs`, undefined, true),
  /** Archive an item: junk, or done with. A new message in its conversation brings it back. */
  archiveItem: (itemId: string) => post<FactorySnapshot>(`/items/${itemId}/archive`),
  stats: (days: number) => call<FactoryStats>(`/stats?days=${days}`, undefined, true),
};
