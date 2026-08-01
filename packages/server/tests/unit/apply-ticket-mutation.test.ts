import { describe, it, expect, vi } from 'vitest';
import { ApplyTicketMutationUseCase } from '../../src/application/use-cases/apply-ticket-mutation.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { TicketNotFoundError } from '../../src/domain/errors.js';

/**
 * `PATCH /api/tickets/:id` and `POST /api/tickets/:id/move` were inlined in the
 * route handlers until native steps needed the same write path. There were no
 * HTTP tests covering them, so these tests are the safety net that extraction
 * did not have: they pin the observable behaviour each route relied on —
 * which activity row is written, which event is emitted.
 *
 * The distinction between `move` and `fields` is the whole point. Folding the
 * status into `fields` would silently turn every board drag into a generic
 * `ticket.updated` and break the automations listening for `ticket.moved`.
 */

const makeTicket = () => TicketEntity.create({
  id: 't-1', boardId: 'b-1', displayId: 1, title: 'T', description: '',
  status: 'backlog', priority: 'medium', type: 'feature', position: 5, tags: [],
});

function harness(ticket: TicketEntity | null = makeTicket()) {
  const ticketStore = {
    getTicketById: vi.fn().mockResolvedValue(ticket),
    saveTicket: vi.fn(),
    saveActivity: vi.fn(),
  };
  const eventBus = { emit: vi.fn() };
  const uc = new ApplyTicketMutationUseCase(ticketStore as never, eventBus as never);
  const activities = () => ticketStore.saveActivity.mock.calls
    .map(([a]) => a as { action: string; source: string; actorType: string });
  const events = () => eventBus.emit.mock.calls.map(([e]) => e as { type: string });
  return { uc, ticketStore, eventBus, activities, events };
}

describe('ApplyTicketMutationUseCase', () => {
  it('reports a missing ticket instead of silently doing nothing', async () => {
    const { uc } = harness(null);
    await expect(uc.execute({ ticketId: 't-1', fields: { title: 'x' } }))
      .rejects.toThrow(TicketNotFoundError);
  });

  describe('field patch — the PATCH /api/tickets/:id path', () => {
    it('writes an "updated" activity attributed to a web user by default', async () => {
      const { uc, activities } = harness();
      await uc.execute({ ticketId: 't-1', fields: { title: 'Renamed' } });
      expect(activities()).toEqual([
        expect.objectContaining({ action: 'updated', source: 'web', actorType: 'user' }),
      ]);
    });

    it('emits the semantic event for the field that changed, not a blanket update', async () => {
      // The audit trail has to record *what* the user did — `ticket.blocked`,
      // not an opaque `ticket.updated`.
      const { uc, events } = harness();
      await uc.execute({ ticketId: 't-1', fields: { blocked: true } });
      expect(events().map((e) => e.type)).toContain('ticket.blocked');
    });

    it('records nothing when the patch changes nothing', async () => {
      // A no-op PATCH must not pollute the ticket history.
      const { uc, ticketStore, eventBus } = harness();
      await uc.execute({ ticketId: 't-1', fields: { title: 'T' } });
      expect(ticketStore.saveActivity).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('skips the activity but keeps the events when silent', async () => {
      // `?silent=true` exists to stop background sync from spamming the
      // timeline; the UI still needs the event to refresh.
      const { uc, ticketStore, eventBus } = harness();
      await uc.execute({ ticketId: 't-1', fields: { blocked: true }, silent: true });
      expect(ticketStore.saveActivity).not.toHaveBeenCalled();
      expect(eventBus.emit).toHaveBeenCalled();
    });

    it('does not emit ticket.moved for a status sent as a plain field', async () => {
      // PATCH has always routed status through `update()`. Changing that here
      // would retroactively alter REST semantics.
      const { uc, events } = harness();
      await uc.execute({ ticketId: 't-1', fields: { status: 'doing' } });
      expect(events().map((e) => e.type)).not.toContain('ticket.moved');
    });
  });

  describe('move — the POST /api/tickets/:id/move path', () => {
    it('writes a "moved" activity and emits ticket.moved with both statuses', async () => {
      const { uc, activities, events, eventBus } = harness();
      await uc.execute({ ticketId: 't-1', move: { status: 'doing' } });

      expect(activities()).toEqual([expect.objectContaining({ action: 'moved' })]);
      expect(events().map((e) => e.type)).toEqual(['ticket.moved']);
      expect(eventBus.emit.mock.calls[0]?.[0]).toMatchObject({
        fromStatus: 'backlog', toStatus: 'doing',
      });
    });

    it('still emits ticket.moved when the ticket is only reordered in its column', async () => {
      // Dragging within a column is a no-op status-wise but the board must
      // still refresh, so the event is unconditional while the activity is not.
      const { uc, ticketStore, activities, events } = harness();
      await uc.execute({ ticketId: 't-1', move: { status: 'backlog', position: 2 } });

      expect(activities()).toEqual([]);
      expect(events().map((e) => e.type)).toEqual(['ticket.moved']);
      expect((ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity).position).toBe(2);
    });

    it('leaves the position untouched when none is given', async () => {
      const { uc, ticketStore } = harness();
      await uc.execute({ ticketId: 't-1', move: { status: 'doing' } });
      expect((ticketStore.saveTicket.mock.calls[0]?.[0] as TicketEntity).position).toBe(5);
    });
  });

  describe('move and fields together — the native step path', () => {
    it('persists both in a single write', async () => {
      const { uc, ticketStore } = harness();
      const result = await uc.execute({
        ticketId: 't-1', move: { status: 'doing' }, fields: { priority: 'high' },
      });

      expect(ticketStore.saveTicket).toHaveBeenCalledTimes(1);
      expect(result.changed).toEqual(expect.arrayContaining(['status', 'priority']));
    });

    it('keeps the two audit trails separate', async () => {
      // A native step that moves *and* edits must not disguise the move as an
      // ordinary field update.
      const { uc, activities, events } = harness();
      await uc.execute({ ticketId: 't-1', move: { status: 'doing' }, fields: { priority: 'high' } });

      expect(activities().map((a) => a.action)).toEqual(['moved', 'updated']);
      expect(events().map((e) => e.type)).toEqual(['ticket.moved', 'ticket.updated']);
    });

    it('honours the actor so workflow-driven changes are distinguishable from human ones', async () => {
      const { uc, activities } = harness();
      await uc.execute({
        ticketId: 't-1',
        fields: { priority: 'high' },
        actor: { actorType: 'agent', actorName: 'Triage', source: 'api' },
      });
      expect(activities()[0]).toMatchObject({
        actorType: 'agent', actorName: 'Triage', source: 'api',
      });
    });
  });

  describe('applyTo — mutating an already-loaded entity', () => {
    it('never re-reads the ticket it was handed', async () => {
      // This is what lets `ticket.create` + follow-up actions stay one read and
      // one write.
      const { uc, ticketStore } = harness();
      const ticket = makeTicket();

      await uc.applyTo(ticket, { fields: { title: 'Renamed' } });

      expect(ticketStore.getTicketById).not.toHaveBeenCalled();
      expect(ticketStore.saveTicket).toHaveBeenCalledWith(ticket);
      expect(ticket.title).toBe('Renamed');
    });
  });
});
