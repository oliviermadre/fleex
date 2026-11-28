import type { FastifyInstance, FastifyReply } from 'fastify';
import { ForbiddenError } from '../domain/errors.js';
import type { FactoryModule } from './factory.module.js';
import { FactoryError } from './engine.js';
import type { FactoryLayout, FactorySettings, ItemInput } from './types.js';
import { machine, machines, needs, overview, token, tokens, withMachinePatched, withMachines, withoutMachine } from './operate.js';

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
      if (!factory.enabled()) throw new ForbiddenError('The Factory is switched off in this workspace (Settings › General, or `fleex factory enable`)');
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

    const refused = (reply: FastifyReply, err: unknown) => {
      if (err instanceof FactoryError) return reply.code(400).send({ error: 'FACTORY_REFUSED', message: err.message });
      throw err;
    };

    app.get('/api/factory/state', async () => (await ready()).state());
    /** Ids only, for the "managed by the Factory" banner on a ticket; empty rather than 403 when off. */
    app.get('/api/factory/managed', async () => {
      if (!factory.enabled()) return { ticketIds: [] };
      await factory.ensureReady();
      return { ticketIds: [...factory.engine.managedIds()] };
    });

    /*
     * The floor for whoever operates it without the page (the CLI, the MCP, another program): the same snapshot, read
     * as answers of a few lines with no layout in them (`operate.ts`). `/state` stays what the page draws from.
     */
    /** The floor at a glance: stopped or not, how full against its limits, how many wait for someone, what is idle. */
    app.get('/api/factory/overview', async () => overview((await ready()).engine.snapshot()));
    /** What waits for someone and for what (a decision, an answer, a failed run…), the longest wait first. */
    app.get('/api/factory/needs', async () => needs((await ready()).engine.snapshot()));
    /** Every ticket and item on the floor, with where it stands in words; `kind` (ticket, item) and `machineId` narrow it. */
    app.get<{ Querystring: { kind?: string; machineId?: string } }>('/api/factory/tickets', async (request) => {
      const { kind, machineId } = request.query;
      return tokens((await ready()).engine.snapshot()).filter((t) => (!kind || t.kind === kind) && (!machineId || t.machineId === machineId));
    });
    /** One ticket or item of the floor: where it stands, what it waits for, what can be done with it. */
    app.get<{ Params: { ticketId: string } }>('/api/factory/tickets/:ticketId', async (request, reply) => {
      const found = token((await ready()).engine.snapshot(), request.params.ticketId);
      return found ?? reply.code(404).send({ error: 'NOT_FOUND', message: 'This ticket is not on the factory floor' });
    });
    /** The layout alone, as `PUT /api/factory/layout` takes it back: what an export is made of. */
    app.get('/api/factory/layout', async () => ({ layout: (await ready()).engine.snapshot().floor.layout }));
    /** The machines of the floor without their settings, each with how much stands on it; `kind` narrows it. */
    app.get<{ Querystring: { kind?: string } }>('/api/factory/machines', async (request) => {
      const { kind } = request.query;
      return machines((await ready()).engine.snapshot()).filter((m) => !kind || m.kind === kind);
    });
    /** One machine: its settings as the layout holds them (`spec`) and what stands on it. */
    app.get<{ Params: { machineId: string } }>('/api/factory/machines/:machineId', async (request, reply) => {
      const found = machine((await ready()).engine.snapshot(), request.params.machineId);
      return found ?? reply.code(404).send({ error: 'NOT_FOUND', message: 'No such machine on the floor' });
    });
    /*
     * One machine at a time, where the page saves the whole layout: read and written in one go on the server, so a
     * change made here cannot undo one the page made meanwhile. Each is checked as a whole layout is (`normaliseLayout`).
     */
    /** Add a machine (its spec), or several (`{ machines: [...] }`): a line of belts is one request. Ids are given when missing. */
    app.post<{ Body: unknown }>('/api/factory/machines', async (request, reply) => {
      const f = await ready(), body = request.body as { machines?: unknown } | null;
      try {
        const { layout, ids } = withMachines(f.engine.snapshot().floor.layout, Array.isArray(body?.machines) ? body.machines : body);
        await f.engine.setLayout(layout);
        const after = f.engine.snapshot();
        return { machines: ids.map((id) => machine(after, id)).filter((m) => m !== null) };
      } catch (err) { return refused(reply, err); }
    });
    /** Change a machine's settings: what the body names replaces what it had, a null takes a setting off. */
    app.patch<{ Params: { machineId: string }; Body: unknown }>('/api/factory/machines/:machineId', async (request, reply) => {
      const f = await ready();
      try {
        await f.engine.setLayout(withMachinePatched(f.engine.snapshot().floor.layout, request.params.machineId, request.body));
        return machine(f.engine.snapshot(), request.params.machineId);
      } catch (err) { return refused(reply, err); }
    });
    /** Remove a machine. What stood on it is left on the floor where it stood. */
    app.delete<{ Params: { machineId: string } }>('/api/factory/machines/:machineId', async (request, reply) => {
      const f = await ready();
      try {
        await f.engine.setLayout(withoutMachine(f.engine.snapshot().floor.layout, request.params.machineId));
        return { removed: request.params.machineId };
      } catch (err) { return refused(reply, err); }
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
    /** What left by an exit over the last `days` days (7 by default): the tickets it shipped and the items archived there. */
    app.get<{ Querystring: { days?: string } }>('/api/factory/exits/log', async (request) => (await ready()).exitLog(null, Number(request.query.days) || 7));
    app.get<{ Params: { machineId: string }; Querystring: { days?: string } }>('/api/factory/exits/:machineId/log', async (request) => (await ready()).exitLog(request.params.machineId, Number(request.query.days) || 7));
    /**
     * The whole of an item's latest message: its text and, for a mail, its HTML part. One kept before messages were kept
     * whole is asked again from its source (`FactoryEngine.itemBody`).
     */
    app.get<{ Params: { itemId: string } }>('/api/factory/items/:itemId/body', async (request, reply) => {
      const body = await (await ready()).engine.itemBody(request.params.itemId);
      return body ?? reply.code(404).send({ error: 'NOT_FOUND', message: 'No such item on the floor' });
    });
    /**
     * The items archived over the last `days` days (7 by default): by hand, at an exit (which one, when it was kept),
     * dropped by a rule; the latest first.
     */
    app.get<{ Querystring: { days?: string } }>('/api/factory/items/archived', async (request) => {
      const f = await ready(), days = Math.max(1, Math.min(90, Math.floor(Number(request.query.days)) || 7)), since = new Date(Date.now() - days * 86_400_000).toISOString();
      const items = await f.store.listArchivedItems(f.engine.snapshot().floor.id, since);
      return {
        days, since,
        items: items.map((i) => ({ itemId: i.id, source: i.source, title: i.title, author: i.author, url: i.url, tags: i.tags, intakeId: i.intakeId, reason: i.archivedReason, exitId: i.archivedReason === 'exit' ? i.machineId : null, archivedAt: i.archivedAt, createdAt: i.createdAt, messages: i.messages, lastActivityAt: i.lastActivityAt, excerpt: i.excerpt, fields: i.fields })),
      };
    });
    /** An item, on the floor or archived (an archived one opens read only). */
    app.get<{ Params: { itemId: string } }>('/api/factory/items/:itemId', async (request, reply) => {
      const item = await (await ready()).engine.findItem(request.params.itemId);
      return item ?? reply.code(404).send({ error: 'NOT_FOUND', message: 'No such item' });
    });
    /** Bring an archived item back to the intake it came in by. */
    app.post<{ Params: { itemId: string } }>('/api/factory/items/:itemId/bring-back', (request, reply) => guard(reply, (f) => f.engine.bringBack(request.params.itemId)));
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
      /* the tickets' runs and the visits to items, together, the latest first */
      const floorId = f.engine.snapshot().floor.id;
      const [tickets, items] = await Promise.all([f.store.listRecentRuns(floorId, limit, machineId || undefined), f.store.listRecentItemRuns(floorId, limit, machineId || undefined)]);
      return [...tickets, ...items].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
    });
    /** Runs, failures, time and cost per machine over the last `days` days (7 by default, 90 at most). */
    app.get<{ Querystring: { days?: string } }>('/api/factory/stats', async (request) => (await ready()).stats(Number(request.query.days) || 7));
  };
}
