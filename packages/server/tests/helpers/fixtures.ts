import { randomUUID } from 'node:crypto';
import type { TicketStatus, TicketPriority, DeliverableType, CommentVisibility } from '@fleex/shared';
import type { Container } from '../../src/infrastructure/container.js';
import { BoardEntity } from '../../src/domain/entities/board.entity.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import { TicketDeliverableEntity } from '../../src/domain/entities/ticket-deliverable.entity.js';
import { AgentPersonaEntity } from '../../src/domain/entities/agent-persona.entity.js';
import { ApiTokenEntity } from '../../src/domain/entities/api-token.entity.js';

/**
 * Seed helpers that write straight to the stores, bypassing HTTP.
 *
 * A freshly-created test container has NO board: `JsonTicketStore` does not
 * install a default one. Anything ticket-shaped therefore starts with
 * `seedBoard`.
 */

export async function seedBoard(c: Container, params: { name?: string; emoji?: string } = {}): Promise<BoardEntity> {
  const board = BoardEntity.create({
    id: randomUUID(),
    name: params.name ?? 'Test Board',
    ...(params.emoji ? { emoji: params.emoji } : {}),
  });
  await c.ticketStore.saveBoard(board);
  return board;
}

export async function seedTicket(
  c: Container,
  params: {
    boardId: string;
    title?: string;
    description?: string;
    status?: TicketStatus;
    priority?: TicketPriority;
    tags?: string[];
    position?: number;
    assignee?: string | null;
  },
): Promise<TicketEntity> {
  const ticket = TicketEntity.create({
    id: randomUUID(),
    boardId: params.boardId,
    displayId: 0, // createTicket() assigns the real, globally-unique value
    title: params.title ?? 'Test ticket',
    description: params.description ?? '',
    status: params.status ?? 'backlog',
    priority: params.priority ?? 'none',
    tags: params.tags ?? [],
    position: params.position ?? 0,
  });
  await c.ticketStore.createTicket(ticket);
  if (params.assignee !== undefined) {
    ticket.assignee = params.assignee;
    await c.ticketStore.saveTicket(ticket);
  }
  return ticket;
}

export async function seedComment(
  c: Container,
  params: {
    ticketId: string;
    authorName?: string;
    authorType?: 'user' | 'agent';
    body?: string;
    visibility?: CommentVisibility;
    privateRecipients?: string[];
    parentId?: string | null;
  },
): Promise<TicketCommentEntity> {
  const comment = TicketCommentEntity.create({
    id: randomUUID(),
    ticketId: params.ticketId,
    authorType: params.authorType ?? 'user',
    authorName: params.authorName ?? 'tester',
    body: params.body ?? 'hello',
    visibility: params.visibility ?? 'public',
    privateRecipients: params.privateRecipients ?? [],
    parentId: params.parentId ?? null,
  });
  await c.commentStore.save(comment);
  return comment;
}

export async function seedMention(
  c: Container,
  params: {
    ticketId: string;
    commentId?: string;
    targetAgent: string;
    sourceAgent?: string;
  },
): Promise<TicketMentionEntity> {
  const mention = TicketMentionEntity.create({
    id: randomUUID(),
    ticketId: params.ticketId,
    commentId: params.commentId ?? randomUUID(),
    targetAgent: params.targetAgent,
    sourceAgent: params.sourceAgent ?? 'tester',
  });
  await c.mentionStore.save(mention);
  return mention;
}

export async function seedDeliverable(
  c: Container,
  params: {
    ticketId: string;
    agentName?: string;
    type?: DeliverableType;
    title?: string;
    content?: string;
  },
): Promise<TicketDeliverableEntity> {
  const deliverable = TicketDeliverableEntity.create({
    id: randomUUID(),
    ticketId: params.ticketId,
    agentName: params.agentName ?? 'builder',
    type: params.type ?? 'report',
    title: params.title ?? 'A report',
    content: params.content ?? '# Report',
  });
  await c.deliverableStore.save(deliverable);
  return deliverable;
}

export async function seedPersona(
  c: Container,
  params: { name: string; displayName?: string },
): Promise<AgentPersonaEntity> {
  const persona = AgentPersonaEntity.create({
    id: randomUUID(),
    name: params.name,
    displayName: params.displayName ?? params.name,
  });
  await c.personaStore.save(persona);
  return persona;
}

export async function seedAgentToken(
  c: Container,
  params: { name?: string } = {},
): Promise<{ entity: ApiTokenEntity; secret: string }> {
  const created = ApiTokenEntity.create({ id: randomUUID(), name: params.name ?? 'builder' });
  await c.agentTokenStore.save(created.entity);
  return created;
}

/** Headers for the `/api/agents/v1/*` scope. */
export function agentAuth(secret: string, agentName?: string): Record<string, string> {
  return {
    authorization: `Bearer ${secret}`,
    ...(agentName ? { 'x-agent-name': agentName } : {}),
  };
}
