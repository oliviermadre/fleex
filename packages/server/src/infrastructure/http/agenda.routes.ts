import type { FastifyInstance } from 'fastify';
import { AGENDA_ITEM_TYPES, DEFAULT_AGENDA_PREFS, type AgendaPrefs, type AgendaView } from '@fleex/shared';
import type { KvStorePort } from '../../application/ports/kv-store.port.js';
import { MAX_WINDOW_MS, type GetAgendaUseCase } from '../../application/use-cases/get-agenda.js';

const PREFS_KEY = 'agenda:prefs';
const PREFS_MAX_BYTES = 32 * 1024;
const VIEWS = new Set<AgendaView>(['day', 'week', 'month', 'schedule']);
const TYPES = new Set<string>(AGENDA_ITEM_TYPES);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isBoolRecord = (v: unknown): v is Record<string, boolean> =>
  isObject(v) && Object.values(v).every((x) => typeof x === 'boolean');

/**
 * Validate the prefs envelope. Unknown label keys (a label a later version
 * dropped) are discarded rather than refused, so an old browser tab can't
 * lock the user out of saving.
 */
export function parseAgendaPrefs(body: unknown): { prefs: AgendaPrefs } | { error: string } {
  if (!isObject(body)) return { error: 'prefs must be an object' };
  if (JSON.stringify(body).length > PREFS_MAX_BYTES) return { error: 'prefs are too large' };
  const { labels, routines, filters, view } = body;
  if (!isBoolRecord(labels)) return { error: 'labels must map a label to a boolean' };
  if (!isBoolRecord(routines)) return { error: 'routines must map a routine id to a boolean' };
  if (!isObject(filters) || !isStringArray(filters['boards']) || !isStringArray(filters['tags'])) {
    return { error: 'filters.boards and filters.tags must be string arrays' };
  }
  if (typeof view !== 'string' || !VIEWS.has(view as AgendaView)) return { error: 'view must be day, week, month or schedule' };
  const keptLabels = Object.fromEntries(Object.entries(labels).filter(([k]) => TYPES.has(k)));
  return {
    prefs: {
      version: 1,
      labels: keptLabels,
      routines,
      filters: { boards: filters['boards'], tags: filters['tags'] },
      view: view as AgendaView,
    },
  };
}

/**
 * /agenda: the items of a window, and the user's display prefs. Prefs live in
 * the KV store so they follow the user from one browser to another; without a
 * KV store they answer 501 and the client keeps them in memory.
 */
export function agendaRoutes(deps: {
  getAgenda: Pick<GetAgendaUseCase, 'execute'>;
  kvStore: KvStorePort | null | undefined;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { from?: string; to?: string } }>('/api/agenda', async (request, reply) => {
      const from = new Date(request.query.from ?? '');
      const to = new Date(request.query.to ?? '');
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
        return reply.code(400).send({ error: 'from and to must be ISO dates with from < to', code: 'INVALID_RANGE' });
      }
      if (to.getTime() - from.getTime() > MAX_WINDOW_MS) {
        return reply.code(400).send({ error: 'the window is at most 43 days', code: 'INVALID_RANGE' });
      }
      return deps.getAgenda.execute({ from, to, now: now() });
    });

    app.get('/api/agenda/prefs', async (_request, reply) => {
      if (!deps.kvStore) return reply.code(501).send({ error: 'Agenda prefs are unavailable on this storage' });
      const raw = await deps.kvStore.get(PREFS_KEY);
      if (!raw) return DEFAULT_AGENDA_PREFS;
      try {
        const parsed = parseAgendaPrefs(JSON.parse(raw));
        return 'prefs' in parsed ? parsed.prefs : DEFAULT_AGENDA_PREFS;
      } catch {
        return DEFAULT_AGENDA_PREFS;
      }
    });

    app.put<{ Body: unknown }>('/api/agenda/prefs', async (request, reply) => {
      if (!deps.kvStore) return reply.code(501).send({ error: 'Agenda prefs are unavailable on this storage' });
      const parsed = parseAgendaPrefs(request.body);
      if ('error' in parsed) return reply.code(400).send({ error: parsed.error });
      await deps.kvStore.set(PREFS_KEY, JSON.stringify(parsed.prefs));
      return parsed.prefs;
    });
  };
}
