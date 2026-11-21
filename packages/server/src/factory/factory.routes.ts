import type { FastifyInstance, FastifyReply } from 'fastify';
import { ForbiddenError } from '../domain/errors.js';
import type { FactoryModule } from './factory.module.js';
import { FactoryError } from './engine.js';
import type { FactoryLayout, FactorySettings, ItemInput } from './types.js';

type Target = { machineId?: string; x?: number; y?: number };

/**
 * Everything the Factory page needs, under `/api/factory`. Every route but
 * `/status` answers 403 while the feature flag is off, and none exists at all
 * on a storage driver the Factory does not support.
 */
export function factoryRoutes(factory: FactoryModule | null) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get('/api/factory/status', () => ({ supported: !!factory, enabled: !!factory && factory.enabled() }));
    if (!factory) return;

    const ready = async (): Promise<FactoryModule> => {
      if (!factory.enabled()) throw new ForbiddenError('The Factory is switched off in this workspace');
      await factory.ensureReady();
      return factory;
    };
    /** A refused action (unknown machine, full station…) is the caller's to fix: 400, with the reason. */
    const guard = async (reply: FastifyReply, fn: (f: FactoryModule) => Promise<void>) => {
      const f = await ready();
      try { await fn(f); } catch (err) {
        if (err instanceof FactoryError) return reply.code(400).send({ error: 'FACTORY_REFUSED', message: err.message });
        throw err;
      }
      return f.state();
    };

    app.get('/api/factory/state', async () => (await ready()).state());
    /** Ids only, for the "managed by the Factory" banner on a ticket; empty rather than 403 when off. */
    app.get('/api/factory/managed', async () => {
      if (!factory.enabled()) return { ticketIds: [] };
      await factory.ensureReady();
      return { ticketIds: [...factory.engine.managedIds()] };
    });

    app.post('/api/factory/notice/ack', async () => { const f = await ready(); f.engine.ackNotice(); return f.state(); });
    app.put<{ Body: { layout: FactoryLayout } }>('/api/factory/layout', (request, reply) => guard(reply, (f) => f.engine.setLayout(request.body?.layout)));
    app.post<{ Body: { on?: boolean } }>('/api/factory/halt', (request, reply) => guard(reply, (f) => f.engine.setHalted(request.body?.on !== false)));
    app.put<{ Body: Partial<FactorySettings> }>('/api/factory/settings', (request, reply) => guard(reply, (f) => f.engine.setSettings(request.body ?? {})));

    app.post<{ Params: { ticketId: string }; Body: Target }>('/api/factory/tickets/:ticketId/transfer', (request, reply) => guard(reply, (f) => f.engine.transfer(request.params.ticketId, request.body ?? {})));
    app.post<{ Params: { ticketId: string }; Body: Target }>('/api/factory/tickets/:ticketId/move', (request, reply) => guard(reply, (f) => f.engine.move(request.params.ticketId, request.body ?? {})));
    app.post<{ Params: { ticketId: string } }>('/api/factory/tickets/:ticketId/release', (request, reply) => guard(reply, (f) => f.engine.release(request.params.ticketId)));
    app.post<{ Params: { ticketId: string }; Body: { outcome: string; reason?: string } }>('/api/factory/tickets/:ticketId/resolve', (request, reply) => guard(reply, (f) => f.engine.resolveGate(request.params.ticketId, String(request.body?.outcome ?? ''), String(request.body?.reason ?? ''))));
    app.post<{ Params: { ticketId: string } }>('/api/factory/tickets/:ticketId/refresh', (request, reply) => guard(reply, (f) => f.engine.refreshInfo(request.params.ticketId)));
    app.post<{ Params: { ticketId: string } }>('/api/factory/tickets/:ticketId/retry', (request, reply) => guard(reply, (f) => f.engine.retry(request.params.ticketId)));
    /** Take a ticket off its station's hands (a run in progress is stopped), and put one back: run the station again, or leave it by an outcome. */
    app.post<{ Params: { ticketId: string } }>('/api/factory/tickets/:ticketId/aside', (request, reply) => guard(reply, (f) => f.engine.setAside(request.params.ticketId)));
    app.post<{ Params: { ticketId: string }; Body: { how?: string; outcome?: string } }>('/api/factory/tickets/:ticketId/put-back', (request, reply) =>
      guard(reply, (f) => f.engine.putBack(request.params.ticketId, request.body?.how === 'as' ? 'as' : 'again', String(request.body?.outcome ?? ''))));
    /** A station's switch: off, it takes tickets in but starts nothing on them. */
    app.post<{ Params: { machineId: string }; Body: { on?: boolean } }>('/api/factory/machines/:machineId/power', (request, reply) => guard(reply, (f) => f.engine.setPower(request.params.machineId, request.body?.on !== false)));
    app.delete<{ Params: { ticketId: string } }>('/api/factory/tickets/:ticketId', (request, reply) => guard(reply, (f) => f.engine.giveBack(request.params.ticketId)));

    /**
     * A conversation moved in a source: a new item, or a new message on a known one (see `FactoryEngine.ingest`). What
     * the sources' connectors will call; until they exist, how an item is made by hand. Answers what became of it.
     */
    app.post<{ Body: ItemInput }>('/api/factory/items', async (request, reply) => {
      const f = await ready();
      /* with the live feed's position, as every other answer that carries the floor */
      try { return { ...(await f.engine.ingest(request.body)), snapshot: f.state() }; } catch (err) {
        if (err instanceof FactoryError) return reply.code(400).send({ error: 'FACTORY_REFUSED', message: err.message });
        throw err;
      }
    });
    /** Whether the mailbox the Gmail intakes read can be read (gogcli installed, Gmail authorized). */
    app.get<{ Querystring: { refresh?: string } }>('/api/factory/mail/status', async (request) => {
      const f = await ready();
      if (!f.mail) return { provider: null, installed: false, version: null, connected: false, account: null, error: 'No mail reader on this Fleex server', setupUrl: null };
      return f.mail.status(request.query.refresh === '1' || request.query.refresh === 'true');
    });
    /** Pull a Gmail intake now, without waiting for its interval: how many messages it saw, and what became of them. */
    app.post<{ Params: { machineId: string } }>('/api/factory/intakes/:machineId/pull', async (request) => {
      const f = await ready();
      return { ...(await f.puller.pull(request.params.machineId)), snapshot: f.state() };
    });
    /** What stations did with an item and what they answered, oldest first. */
    app.get<{ Params: { itemId: string } }>('/api/factory/items/:itemId/runs', async (request) => { await ready(); return factory.store.listItemRuns(request.params.itemId); });
    /** Change what the Factory keeps of an item: title, author, link, text, tags, its source's fields. */
    app.patch<{ Params: { itemId: string }; Body: Record<string, unknown> }>('/api/factory/items/:itemId', (request, reply) => guard(reply, (f) => f.engine.editItem(request.params.itemId, request.body ?? {})));
    /** Archive an item (soft delete): it is junk, or done with. A new message in its conversation brings it back. */
    app.post<{ Params: { itemId: string } }>('/api/factory/items/:itemId/archive', (request, reply) => guard(reply, (f) => f.engine.archiveItem(request.params.itemId)));

    app.get<{ Params: { ticketId: string } }>('/api/factory/tickets/:ticketId/runs', async (request) => {
      await ready();
      return factory.store.listRunsByTicket(request.params.ticketId);
    });
    /** The latest runs of the floor, or of one machine with `machineId`. */
    app.get<{ Querystring: { limit?: string; machineId?: string } }>('/api/factory/runs', async (request) => {
      const f = await ready(), limit = Math.max(1, Math.min(200, Number(request.query.limit) || 50)), machineId = request.query.machineId;
      return f.store.listRecentRuns(f.engine.snapshot().floor.id, limit, machineId || undefined);
    });
    /** Runs, failures, time and cost per machine over the last `days` days (7 by default, 90 at most). */
    app.get<{ Querystring: { days?: string } }>('/api/factory/stats', async (request) => (await ready()).stats(Number(request.query.days) || 7));
  };
}
