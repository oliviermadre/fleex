import { randomUUID } from 'node:crypto';
import type { TicketTodoEvent, TodoActorType, TodoAssignee, TodoAssigneeInput, TodoEventAction, TodoSource, TodoWriteResult } from '@fleex/shared';
import { sameTodoAssignee } from '@fleex/shared';
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
  /**
   * The persona slug of an agent run (FLEEX_ACTOR_PERSONA), lower-case: how
   * `me` resolves and which items are "for you". Absent for the human and for
   * runs without a persona (a panel's orchestrator).
   */
  persona?: string;
}

export interface TodoCreateInput {
  text: string;
  note?: string | null;
  /** Insert right after this item (ref or id); default: end of the list. */
  after?: string | number | null;
  /**
   * Who the item is for. Omitted = the default: the human for an item the
   * human creates, anyone for an item an agent creates.
   */
  assignee?: TodoAssigneeInput;
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
  /** Reassign (null / 'none' = anyone). An agent taking over the human's item must give `reason`. */
  assignee?: TodoAssigneeInput;
  /** `false` restores a deleted item (the Undo of a delete). */
  deleted?: boolean;
}

const SLUG = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;

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
 * Rights: everybody may create, edit, check, cancel and reopen any item, with
 * two guards for agents (the human may do everything):
 * - an agent may not delete an item a human created — it cancels it instead;
 * - an item assigned to the human is theirs: an agent may not check, cancel,
 *   reopen, retitle or delete it. It may take it over (reassign it) only with
 *   a reason — for when the human asked it to — and the takeover is shown.
 */
export class TicketTodosUseCase {
  constructor(
    private readonly store: TodoStorePort,
    private readonly ticketStore: TicketStorePort,
    private readonly emit: (event: AnyDomainEvent) => void,
    /** The configured human's name: what `user` / `me` (for the human) resolve to. */
    private readonly humanName: () => string = () => 'user',
    /** Does this persona slug exist? Catches `--to buidler`. Unchecked when absent. */
    private readonly personaExists?: (slug: string) => Promise<boolean>,
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

    const assignee = input.assignee !== undefined
      ? await this.resolveAssignee(input.assignee, actor)
      : actor.type === 'user' ? this.human() : null;

    for (let attempt = 0; attempt < REF_RETRIES; attempt++) {
      const ref = (await this.store.maxRef(ticketId)) + 1;
      const item = TicketTodoItemEntity.create({
        id: randomUUID(), ticketId, ref, text: input.text, note: input.note ?? null, position, actor, assignee,
      });
      const history = [this.event(item, 'created', assignee ? { assignee: { from: null, to: assignee } } : {}, actor)];
      if ((await this.store.insertItem(item, history)) === 'ref_conflict') continue;
      this.emit({ type: 'todo.created', ticketId, item: item.toDTO(), history, occurredAt: new Date() });
      return { item: item.toDTO(), history };
    }
    throw new Error(`Could not allocate a todo ref on ticket ${ticketId} after ${REF_RETRIES} attempts`);
  }

  async update(ticketId: string, itemKey: string, input: TodoUpdateInput, actor: TodoActor): Promise<TodoWriteResult> {
    const ticket = await this.requireTicket(ticketId);
    const item = input.deleted === false
      ? await this.requireAnyItem(ticketId, ticket.displayId, itemKey)
      : await this.requireItem(ticketId, ticket.displayId, itemKey);

    // Rights are judged on the item as it is before this patch: a takeover and
    // a `done` in one call cannot slip past the guard.
    const state = input.state !== undefined ? normaliseState(input.state) : undefined;
    const assignee = input.assignee !== undefined ? await this.resolveAssignee(input.assignee, actor) : undefined;
    const reassigning = assignee !== undefined && !sameTodoAssignee(item.assignee, assignee);
    const takeover = actor.type === 'agent' && item.assignedToHuman && reassigning;
    if (actor.type === 'agent' && item.assignedToHuman) {
      const touchesState = state !== undefined && state !== item.state;
      const touchesText = input.text !== undefined && String(input.text).trim() !== item.text;
      if (touchesState || touchesText) throw new ForbiddenError(leaveIt(item, ticket.displayId));
      if (takeover && !String(input.reason ?? '').trim()) {
        throw new InvalidTodoError(
          `taking over an item assigned to ${humanOf(item)} requires --reason (quote or summarise ${humanOf(item)}'s request)`,
        );
      }
    }

    // Compute every change before writing anything: a bad field rejects the whole patch.
    const restore = input.deleted === false ? item.restore() : null;
    if (!restore && item.deletedAt) throw new TodoItemNotFoundError(itemKey.replace(/^#/, ''), `#${ticket.displayId}`);
    const edit = input.text !== undefined || input.note !== undefined
      ? item.edit({ text: input.text, note: input.note })
      : null;
    const assign = assignee !== undefined ? item.assign(assignee, actor, input.reason ?? null, takeover) : null;
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
    if (restore) history.push(this.event(item, 'edited', restore, actor));
    if (edit) history.push(this.event(item, 'edited', edit, actor));
    if (assign) history.push(this.event(item, 'assigned', assign, actor));
    if (transition) history.push(this.event(item, 'state_changed', transition, actor));
    if (move) history.push(this.event(item, 'moved', move, actor));
    if (history.length > 0) {
      await this.store.saveItem(item, history);
      this.emit({ type: 'todo.updated', ticketId, item: item.toDTO(), history, occurredAt: new Date() });
    }
    return { item: item.toDTO(), history };
  }

  async remove(ticketId: string, itemKey: string, actor: TodoActor): Promise<TodoWriteResult> {
    const ticket = await this.requireTicket(ticketId);
    const item = await this.requireItem(ticketId, ticket.displayId, itemKey);
    if (actor.type === 'agent' && item.assignedToHuman) throw new ForbiddenError(leaveIt(item, ticket.displayId));
    if (actor.type === 'agent' && item.createdByType === 'user') {
      throw new ForbiddenError(`agents cannot delete an item created by ${item.createdByName} — use \`todo cancel\``);
    }
    item.markDeleted();
    const history = [this.event(item, 'deleted', {}, actor)];
    await this.store.saveItem(item, history);
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

  /** A history row, written by the store together with the item (see TodoStorePort). */
  private event(
    item: TicketTodoItemEntity,
    action: TodoEventAction,
    changes: TodoChanges,
    actor: TodoActor,
  ): TicketTodoEvent {
    return {
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
  }

  private human(): TodoAssignee {
    return { type: 'user', name: this.humanName() };
  }

  /**
   * `me` (the caller), `user` (the human), `agent` (any agent), `none` (anyone),
   * a persona slug, or the object form. The human's name is always the
   * configured one, whatever a client sends.
   */
  private async resolveAssignee(input: TodoAssigneeInput, actor: TodoActor): Promise<TodoAssignee | null> {
    if (input === null) return null;
    if (typeof input === 'object') {
      if (input.type === 'user') return this.human();
      if (input.type === 'agent') return input.name ? this.persona(input.name) : { type: 'agent', name: null };
      throw new InvalidTodoError(`Invalid assignee type: ${String((input as { type?: unknown }).type)}`);
    }
    const key = String(input).trim().toLowerCase();
    switch (key) {
      case 'none':
      case 'anyone':
      case '':
        return null;
      case 'user':
      case 'human':
        return this.human();
      case 'agent':
        return { type: 'agent', name: null };
      case 'me':
        if (actor.type === 'user') return this.human();
        if (!actor.persona) {
          throw new InvalidTodoError('`me` needs the persona of the agent run (FLEEX_ACTOR_PERSONA) — use `agent` or a persona slug');
        }
        return { type: 'agent', name: actor.persona };
      default:
        return this.persona(key);
    }
  }

  private async persona(raw: string): Promise<TodoAssignee> {
    const slug = raw.trim().toLowerCase();
    if (!SLUG.test(slug)) throw new InvalidTodoError(`Invalid assignee: ${raw} (valid: me, user, agent, none, or a persona slug)`);
    if (this.personaExists && !(await this.personaExists(slug))) {
      throw new InvalidTodoError(`Unknown persona: ${slug} (valid: me, user, agent, none, or a persona slug)`);
    }
    return { type: 'agent', name: slug };
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

  /** Deleted items included: what a restore needs. */
  private async requireAnyItem(ticketId: string, displayId: number, key: string): Promise<TicketTodoItemEntity> {
    const item = await this.findItem(ticketId, key);
    if (!item) throw new TodoItemNotFoundError(key.replace(/^#/, ''), `#${displayId}`);
    return item;
  }

  private async findItem(ticketId: string, key: string): Promise<TicketTodoItemEntity | null> {
    const trimmed = key.trim();
    if (/^#?\d+$/.test(trimmed)) return this.store.getItemByRef(ticketId, Number(trimmed.replace(/^#/, '')));
    const item = await this.store.getItemById(trimmed);
    return item && item.ticketId === ticketId ? item : null;
  }
}

function humanOf(item: TicketTodoItemEntity): string {
  return item.assignee?.name ?? 'the human';
}

/** The 403 an agent gets on the human's item — with the one legitimate way out. */
function leaveIt(item: TicketTodoItemEntity, displayId: number): string {
  const who = humanOf(item);
  return `#${item.ref} is assigned to ${who} — leave it. Only if ${who} explicitly asked you to take over their items, `
    + `reassign it first: fleex ticket todo assign ${displayId} ${item.ref} me --reason "…"`;
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
