import { randomUUID } from 'node:crypto';
import type { TicketTodoEvent, TodoActorType, TodoEventAction, TodoSource, TodoWriteResult } from '@fleex/shared';
import { TicketTodoItemEntity, type TodoChanges } from '../../domain/entities/ticket-todo-item.entity.js';
import { ForbiddenError, InvalidTodoError, TicketNotFoundError, TodoItemNotFoundError } from '../../domain/errors.js';
import type { AnyDomainEvent } from '../../domain/events.js';
import type { TodoStorePort } from '../ports/todo-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';

/** Who acts, and from where. Recorded on every history row. */
export interface TodoActor {
  type: TodoActorType;
  name: string;
  source: TodoSource;
}

export interface TodoCreateInput {
  text: string;
  note?: string | null;
  /** Insert right after this item (ref or id); default: end of the list. */
  after?: string | number | null;
}

export interface TodoUpdateInput {
  text?: string;
  note?: string | null;
  /** 'todo' is accepted as an alias of 'open'. */
  state?: string;
  /** Reason of a cancel, kept in the history and shown under the item. */
  reason?: string | null;
  /** Move right after this item (ref or id); null = first. */
  after?: string | number | null;
  /** Raw position (UI drag); `after` wins when both are given. */
  position?: number;
}

/**
 * How many times a create retries when a concurrent create took its ref.
 * Concurrent creates collide in lockstep — each round exactly one wins — so N
 * simultaneous writers need up to N rounds. Real lists see 2-3 at most.
 */
const REF_RETRIES = 20;

/**
 * A ticket's shared todo list. Every write leaves one history row per kind of
 * change (created / edited / state_changed / moved / deleted) and emits the
 * domain event the WS broadcast listens to, so the web routes, the agent
 * routes and the CLI/MCP behind them share one behaviour.
 *
 * Rights: everybody may create, edit, check, cancel and reopen any item. An
 * agent may not delete an item a human created — it cancels it instead.
 */
export class TicketTodosUseCase {
  constructor(
    private readonly store: TodoStorePort,
    private readonly ticketStore: TicketStorePort,
    private readonly emit: (event: AnyDomainEvent) => void,
  ) {}

  async list(ticketId: string): Promise<TicketTodoItemEntity[]> {
    await this.requireTicket(ticketId);
    return this.store.listItems(ticketId);
  }

  async create(ticketId: string, input: TodoCreateInput, actor: TodoActor): Promise<TodoWriteResult> {
    const ticket = await this.requireTicket(ticketId);
    const live = await this.store.listItems(ticketId);
    const position = input.after !== undefined && input.after !== null
      ? positionAfter(live, await this.requireItem(ticketId, ticket.displayId, String(input.after)))
      : nextPosition(live);

    for (let attempt = 0; attempt < REF_RETRIES; attempt++) {
      const ref = (await this.store.maxRef(ticketId)) + 1;
      const item = TicketTodoItemEntity.create({
        id: randomUUID(), ticketId, ref, text: input.text, note: input.note ?? null, position, actor,
      });
      if ((await this.store.insertItem(item)) === 'ref_conflict') continue;
      const history = [await this.record(item, 'created', {}, actor)];
      this.emit({ type: 'todo.created', ticketId, item: item.toDTO(), history, occurredAt: new Date() });
      return { item: item.toDTO(), history };
    }
    throw new Error(`Could not allocate a todo ref on ticket ${ticketId} after ${REF_RETRIES} attempts`);
  }

  async update(ticketId: string, itemKey: string, input: TodoUpdateInput, actor: TodoActor): Promise<TodoWriteResult> {
    const ticket = await this.requireTicket(ticketId);
    const item = await this.requireItem(ticketId, ticket.displayId, itemKey);

    // Compute every change before writing anything: a bad field rejects the whole patch.
    const edit = input.text !== undefined || input.note !== undefined
      ? item.edit({ text: input.text, note: input.note })
      : null;
    const state = input.state !== undefined ? normaliseState(input.state) : undefined;
    const transition = state !== undefined ? item.transition(state, actor, input.reason) : null;
    let move: TodoChanges | null = null;
    if (input.after !== undefined) {
      const live = (await this.store.listItems(ticketId)).filter((i) => i.id !== item.id);
      const target = input.after === null ? null : await this.requireItem(ticketId, ticket.displayId, String(input.after));
      if (target && target.id === item.id) throw new InvalidTodoError('An item cannot be moved after itself');
      move = item.moveTo(target ? positionAfter(live, target) : firstPosition(live));
    } else if (input.position !== undefined) {
      move = item.moveTo(Number(input.position));
    }

    const history: TicketTodoEvent[] = [];
    if (edit || transition || move) {
      await this.store.saveItem(item);
      if (edit) history.push(await this.record(item, 'edited', edit, actor));
      if (transition) history.push(await this.record(item, 'state_changed', transition, actor));
      if (move) history.push(await this.record(item, 'moved', move, actor));
      this.emit({ type: 'todo.updated', ticketId, item: item.toDTO(), history, occurredAt: new Date() });
    }
    return { item: item.toDTO(), history };
  }

  async remove(ticketId: string, itemKey: string, actor: TodoActor): Promise<TodoWriteResult> {
    const ticket = await this.requireTicket(ticketId);
    const item = await this.requireItem(ticketId, ticket.displayId, itemKey);
    if (actor.type === 'agent' && item.createdByType === 'user') {
      throw new ForbiddenError(`agents cannot delete an item created by ${item.createdByName} — use \`todo cancel\``);
    }
    item.markDeleted();
    await this.store.saveItem(item);
    const history = [await this.record(item, 'deleted', {}, actor)];
    this.emit({ type: 'todo.deleted', ticketId, itemId: item.id, history, occurredAt: new Date() });
    return { item: item.toDTO(), history };
  }

  /** History, newest first: the whole list, or one item (deleted ones too). */
  async history(ticketId: string, itemKey?: string): Promise<TicketTodoEvent[]> {
    const ticket = await this.requireTicket(ticketId);
    if (itemKey === undefined || itemKey === '') return this.store.listEvents(ticketId);
    const item = await this.findItem(ticketId, itemKey);
    if (!item) throw new TodoItemNotFoundError(itemKey.replace(/^#/, ''), `#${ticket.displayId}`);
    return this.store.listEvents(ticketId, item.id);
  }

  private async record(
    item: TicketTodoItemEntity,
    action: TodoEventAction,
    changes: TodoChanges,
    actor: TodoActor,
  ): Promise<TicketTodoEvent> {
    const event: TicketTodoEvent = {
      id: randomUUID(),
      itemId: item.id,
      ticketId: item.ticketId,
      itemRef: item.ref,
      itemText: item.text,
      action,
      changes,
      actorType: actor.type,
      actorName: actor.name,
      source: actor.source,
      createdAt: new Date().toISOString(),
    };
    await this.store.addEvent(event);
    return event;
  }

  private async requireTicket(ticketId: string) {
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) throw new TicketNotFoundError(ticketId);
    return ticket;
  }

  /** A live (not deleted) item of this ticket, by ref (`3`, `#3`) or id. */
  private async requireItem(ticketId: string, displayId: number, key: string): Promise<TicketTodoItemEntity> {
    const item = await this.findItem(ticketId, key);
    if (!item || item.deletedAt) throw new TodoItemNotFoundError(key.replace(/^#/, ''), `#${displayId}`);
    return item;
  }

  private async findItem(ticketId: string, key: string): Promise<TicketTodoItemEntity | null> {
    const trimmed = key.trim();
    if (/^#?\d+$/.test(trimmed)) return this.store.getItemByRef(ticketId, Number(trimmed.replace(/^#/, '')));
    const item = await this.store.getItemById(trimmed);
    return item && item.ticketId === ticketId ? item : null;
  }
}

function normaliseState(raw: string): string {
  return raw === 'todo' ? 'open' : raw;
}

function nextPosition(live: TicketTodoItemEntity[]): number {
  return live.length === 0 ? 1 : Math.max(...live.map((i) => i.position)) + 1;
}

function firstPosition(live: TicketTodoItemEntity[]): number {
  return live.length === 0 ? 1 : Math.min(...live.map((i) => i.position)) - 1;
}

/** Midway between `target` and whatever follows it (fractional ordering). */
function positionAfter(live: TicketTodoItemEntity[], target: TicketTodoItemEntity): number {
  const next = live
    .filter((i) => i.id !== target.id && i.position > target.position)
    .reduce<TicketTodoItemEntity | null>((best, i) => (!best || i.position < best.position ? i : best), null);
  return next ? (target.position + next.position) / 2 : target.position + 1;
}
