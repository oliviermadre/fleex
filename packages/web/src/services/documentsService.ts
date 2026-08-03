import type { TicketDeliverable } from '@fleex/shared';

import { API_URL } from '../lib/constants';

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const documentsService = {
  getAll: (): Promise<TicketDeliverable[]> => request('/deliverables'),
};
