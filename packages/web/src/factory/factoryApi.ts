import { API_URL } from '../lib/constants';
import { toast } from '../lib/toast';
import type { ItemSource } from './items';
import type { ItemFields } from './types';
import type { ArchivedItem, ExitLog, FactoryLayout, FactoryRun, FactorySettings, FactorySnapshot, FactoryStats, Target } from './types';

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
export interface MailStatus { provider: string | null; installed: boolean; version: string | null; connected: boolean; account: string | null; error: string | null; setupUrl: string | null }
export interface PullResult { pulled: number; new: number; updated: number; moved: number; error: string | null }
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
  ingest: (item: { source: ItemSource; key: string; title: string; author?: string; excerpt?: string; url?: string | null; tags?: string[]; fields?: ItemFields }) =>
    post<{ itemId: string | null; status: 'new' | 'updated' | 'back' | 'dropped' | 'moved' | 'seen'; snapshot: FactorySnapshot }>('/items', item),
  /** Whether the mailbox the Gmail intakes read can be read: gogcli installed, Gmail authorized. */
  mailStatus: (refresh = false) => call<MailStatus>(`/mail/status${refresh ? '?refresh=1' : ''}`, undefined, true),
  /** Pull a Gmail intake now: how many messages it saw, and what became of them. */
  pullIntake: (machineId: string) => post<PullResult & { snapshot: FactorySnapshot }>(`/intakes/${machineId}/pull`),
  /** The whole of an item's latest message: its text, and its HTML part for a mail. */
  itemBody: (itemId: string) => call<{ text: string; html: string | null; kept: boolean }>(`/items/${itemId}/body`, undefined, true),
  /** What stations did with an item and what they answered, oldest first. */
  itemRuns: (itemId: string) => call<FactoryRun[]>(`/items/${itemId}/runs`, undefined, true),
  /** Change what the Factory keeps of an item: title, author, link, text, tags, its source's fields. */
  editItem: (itemId: string, patch: { title?: string; author?: string; url?: string | null; excerpt?: string; tags?: string[]; fields?: ItemFields }) =>
    call<FactorySnapshot>(`/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  /** The items archived over the last `days` days, the latest first. */
  archivedItems: (days: number) => call<{ days: number; since: string; items: ArchivedItem[] }>(`/items/archived?days=${days}`, undefined, true),
  /** An item, on the floor or archived. */
  item: (itemId: string) => call<unknown>(`/items/${itemId}`, undefined, true),
  /** Bring an archived item back to the intake it came in by. */
  bringBack: (itemId: string) => post<FactorySnapshot>(`/items/${itemId}/bring-back`),
  /** Archive an item: junk, or done with. A new message in its conversation brings it back. */
  archiveItem: (itemId: string) => post<FactorySnapshot>(`/items/${itemId}/archive`),
  /** What left by an exit (by every exit of the floor, with null) over the last `days` days. */
  exitLog: (machineId: string | null, days: number) => call<ExitLog>(`/exits/${machineId ? `${encodeURIComponent(machineId)}/` : ''}log?days=${days}`, undefined, true),
  stats: (days: number) => call<FactoryStats>(`/stats?days=${days}`, undefined, true),
};
