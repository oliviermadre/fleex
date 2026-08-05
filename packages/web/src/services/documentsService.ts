import type { DeliverableFacets, DeliverablePage } from '@fleex/shared';
import { API_URL } from '../lib/constants';

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface DocumentFilters {
  types: string[];
  agentNames: string[];
  statuses: string[];
  /** `ticket` / `routine` — what the document hangs off. */
  originKinds: string[];
  /** Free text matched against document title, ticket title or routine name. */
  search: string;
}

function toParams(filters: DocumentFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const t of filters.types) params.append('type', t);
  for (const a of filters.agentNames) params.append('agent_name', a);
  for (const s of filters.statuses) params.append('status', s);
  for (const o of filters.originKinds) params.append('origin', o);
  if (filters.search.trim()) params.set('q', filters.search.trim());
  return params;
}

export const documentsService = {
  /** One page of documents, newest-updated first, with the DB-side total. */
  list: (filters: DocumentFilters, limit: number, offset: number): Promise<DeliverablePage> => {
    const params = toParams(filters);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return request(`/deliverables?${params}`);
  },

  /** Sidebar counts, aggregated over the whole table — not over the loaded page. */
  facets: (filters: DocumentFilters): Promise<DeliverableFacets> => {
    const params = toParams(filters);
    const qs = params.toString();
    return request(`/deliverables/facets${qs ? `?${qs}` : ''}`);
  },
};
