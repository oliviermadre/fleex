import type { TicketStatus, TicketPriority, TicketType } from '@fleex/shared';
import type { NativeOperationImpl } from './types.js';
import { postWorkflowComment } from '../workflow-comment.js';

/**
 * Server-side behaviour of the native operations. Each entry is keyed by the
 * same id as its descriptor in `@fleex/shared` — `registry.test.ts` fails if the
 * two ever diverge.
 *
 * `plan()` is a pure function of (params, ticket snapshot): no IO, no store, no
 * clock. That is what makes a native step unit-testable and deterministic.
 */

const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));
const strOrNull = (v: unknown): string | null =>
  v === undefined || v === null || v === '' ? null : str(v);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s) => s.length > 0) : [];

export const TICKET_OPERATIONS: readonly NativeOperationImpl[] = [
  {
    id: 'ticket.create',
    plan: ({ params }) => ({
      kind: 'create',
      input: {
        boardId: str(params['boardId']),
        title: str(params['title']),
        description: params['description'] === undefined ? undefined : str(params['description']),
        status: params['status'] === undefined ? undefined : (params['status'] as TicketStatus),
        priority: params['priority'] === undefined ? undefined : (params['priority'] as TicketPriority),
        type: params['type'] === undefined ? undefined : (params['type'] as TicketType | null),
        tags: params['tags'] === undefined ? undefined : strList(params['tags']),
        dueDate: params['dueDate'] === undefined ? undefined : strOrNull(params['dueDate']),
      },
    }),
  },
  {
    id: 'ticket.upsert',
    plan: ({ params }) => {
      const ref = str(params['externalRef']);
      const url = strOrNull(params['url']);
      return {
        kind: 'create',
        upsert: {
          ref,
          onExisting: params['onExisting'] === 'update' ? 'update' : 'skip',
        },
        input: {
          boardId: str(params['boardId']),
          title: str(params['title']),
          description: params['description'] === undefined ? undefined : str(params['description']),
          status: params['status'] === undefined ? undefined : (params['status'] as TicketStatus),
          priority: params['priority'] === undefined ? undefined : (params['priority'] as TicketPriority),
          type: params['type'] === undefined ? undefined : (params['type'] as TicketType | null),
          tags: params['tags'] === undefined ? undefined : strList(params['tags']),
          dueDate: params['dueDate'] === undefined ? undefined : strOrNull(params['dueDate']),
          // The dedup key travels with the create so the very first import is
          // already linked — findable by the next run without a second write.
          links: [{ type: 'external', ref, label: ref, url }],
        },
      };
    },
  },
  {
    // The whole point of AC7: status never travels through `update()`, because
    // only `moveTo()` produces the `moved` activity and the `ticket.moved` event.
    id: 'ticket.set_status',
    plan: ({ params }) => ({ kind: 'move', status: params['status'] as TicketStatus }),
  },
  {
    id: 'ticket.set_priority',
    plan: ({ params }) => ({ kind: 'field', patch: { priority: params['priority'] as TicketPriority } }),
  },
  {
    id: 'ticket.set_type',
    plan: ({ params }) => ({ kind: 'field', patch: { type: (params['type'] ?? null) as TicketType | null } }),
  },
  {
    id: 'ticket.set_title',
    plan: ({ params }) => ({ kind: 'field', patch: { title: str(params['title']) } }),
  },
  {
    id: 'ticket.set_description',
    plan: ({ params, ticket }) => {
      const next = str(params['description']);
      const mode = str(params['mode'] || 'replace');
      const current = ticket?.description ?? '';
      const description =
        mode === 'append' ? (current ? `${current}\n\n${next}` : next)
        : mode === 'prepend' ? (current ? `${next}\n\n${current}` : next)
        : next;
      return { kind: 'field', patch: { description } };
    },
  },
  {
    id: 'ticket.add_tags',
    plan: ({ params, ticket }) => {
      const current = ticket?.tags ?? [];
      const added = strList(params['tags']).filter((t) => !current.includes(t));
      return { kind: 'field', patch: { tags: [...current, ...added] } };
    },
  },
  {
    id: 'ticket.remove_tags',
    plan: ({ params, ticket }) => {
      const removed = new Set(strList(params['tags']));
      return { kind: 'field', patch: { tags: (ticket?.tags ?? []).filter((t) => !removed.has(t)) } };
    },
  },
  {
    id: 'ticket.set_blocked',
    plan: ({ params }) => ({ kind: 'field', patch: { blocked: params['blocked'] === true } }),
  },
  {
    id: 'ticket.set_due_date',
    plan: ({ params }) => {
      const raw = strOrNull(params['dueDate']);
      return { kind: 'field', patch: { dueDate: raw ? new Date(raw) : null } };
    },
  },
  {
    id: 'ticket.set_assignee',
    plan: ({ params }) => ({ kind: 'field', patch: { assignee: strOrNull(params['assignee']) } }),
  },
  {
    id: 'ticket.post_comment',
    plan: ({ params }) => ({
      kind: 'effect',
      run: async (ctx) => {
        // Posts *and* announces: without the event the comment lands in the
        // database but never reaches an open thread, so a reader watching the
        // ticket sees the workflow finish with nothing to show for it.
        // Mentions stay empty — workflows advance through edges, not mentions.
        const comment = await postWorkflowComment(ctx.deps.postComment, ctx.deps.eventBus, {
          ticketId: ctx.ticketId,
          authorName: ctx.actor.workflowName,
          body: str(params['body']),
        });
        return { commentId: comment?.id ?? null };
      },
    }),
  },
];
