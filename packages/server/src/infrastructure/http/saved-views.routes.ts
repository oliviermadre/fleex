import type { FastifyInstance } from 'fastify';
import type { KvStorePort } from '../../application/ports/kv-store.port.js';

/** The screens that have saved views. */
const SCOPES = new Set(['work', 'agenda']);
const NAME_MAX = 60;
const MAX_VIEWS = 200;

const kvKey = (scope: string) => `saved_views:${scope}`;

export interface SavedViewDTO {
  id: string;
  name: string;
  emoji: string | null;
  /** Opaque to the server: the client's queue filters / display (see web queueFilters.ts). */
  filters: Record<string, unknown>;
  display: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate a PUT body; returns the views (names trimmed) or the reason it's refused.
 * The server only guards the envelope — id, name, emoji, dates — and keeps
 * filters/display as given: their shape belongs to the screen that reads them.
 */
export function parseSavedViews(body: unknown): { views: SavedViewDTO[] } | { error: string } {
  if (!isObject(body) || !Array.isArray(body.views)) return { error: 'views must be an array' };
  if (body.views.length > MAX_VIEWS) return { error: `at most ${MAX_VIEWS} views` };
  const views: SavedViewDTO[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const raw of body.views) {
    if (!isObject(raw)) return { error: 'each view must be an object' };
    const { id, name, emoji, filters, display, createdAt, updatedAt } = raw;
    if (typeof id !== 'string' || !id) return { error: 'view id is required' };
    if (ids.has(id)) return { error: `duplicate view id ${id}` };
    if (typeof name !== 'string') return { error: 'view name is required' };
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > NAME_MAX) return { error: `view name must be 1–${NAME_MAX} characters` };
    if (names.has(trimmed.toLowerCase())) return { error: `duplicate view name "${trimmed}"` };
    if (emoji !== null && emoji !== undefined && typeof emoji !== 'string') return { error: 'view emoji must be a string' };
    if (!isObject(filters) || !isObject(display)) return { error: 'view filters and display are required' };
    if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') return { error: 'view dates are required' };
    ids.add(id);
    names.add(trimmed.toLowerCase());
    views.push({ id, name: trimmed, emoji: emoji || null, filters, display, createdAt, updatedAt });
  }
  return { views };
}

/**
 * A user's saved views for a screen (Tasks today): a named set of filters and
 * grouping, stored as one JSON document in the KV store under
 * `saved_views:<scope>`. Single user, so the last write wins. Storage without a
 * KV store answers 501 — the client then disables views and keeps its filters.
 */
export function savedViewsRoutes(deps: { kvStore: KvStorePort | null | undefined }) {
  return async function (app: FastifyInstance) {
    app.get<{ Params: { scope: string } }>('/api/saved-views/:scope', async (request, reply) => {
      const { scope } = request.params;
      if (!SCOPES.has(scope)) return reply.code(404).send({ error: `Unknown scope "${scope}"` });
      if (!deps.kvStore) return reply.code(501).send({ error: 'Saved views are unavailable on this storage' });
      const raw = await deps.kvStore.get(kvKey(scope));
      if (!raw) return { views: [] };
      try {
        const parsed = parseSavedViews(JSON.parse(raw));
        return 'views' in parsed ? parsed : { views: [] };
      } catch {
        return { views: [] };
      }
    });

    app.put<{ Params: { scope: string }; Body: unknown }>('/api/saved-views/:scope', async (request, reply) => {
      const { scope } = request.params;
      if (!SCOPES.has(scope)) return reply.code(404).send({ error: `Unknown scope "${scope}"` });
      if (!deps.kvStore) return reply.code(501).send({ error: 'Saved views are unavailable on this storage' });
      const parsed = parseSavedViews(request.body);
      if ('error' in parsed) return reply.code(400).send({ error: parsed.error });
      await deps.kvStore.set(kvKey(scope), JSON.stringify({ views: parsed.views }));
      return { views: parsed.views };
    });
  };
}
