/**
 * The CLI's half of todo attribution: an agent run must be credited for what
 * it writes, the human must stay the default, and the source must say whether
 * the MCP or the CLI did it — that is what the todo history shows.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { TicketTodoItem } from '@fleex/shared';
import { actAs, actorHeaders, currentActor } from '../../src/core/actor.ts';
import { hasAssignee, isMine, linesToItems, otherAgentOf } from '../../src/commands/ticket/todo/_shared.ts';

afterEach(() => actAs(undefined));

describe('actorHeaders', () => {
  it('declares nothing but the source for a human at the terminal (server attributes to the human)', () => {
    expect(actorHeaders({})).toEqual({ 'x-fleex-source': 'cli' });
  });

  it('credits the agent of the run (FLEEX_ACTOR_*), URL-encoded for a latin-1 header', () => {
    const h = actorHeaders({ FLEEX_ACTOR_TYPE: 'agent', FLEEX_ACTOR_NAME: 'workflow:Spec → Build' });
    expect(h['x-fleex-actor-type']).toBe('agent');
    expect(decodeURIComponent(h['x-fleex-actor-name']!)).toBe('workflow:Spec → Build');
    expect(() => new Headers(h)).not.toThrow();
  });

  it('says mcp when the MCP server spawned the CLI', () => {
    expect(actorHeaders({ FLEEX_SOURCE: 'mcp' })['x-fleex-source']).toBe('mcp');
  });

  it('sends the persona slug of the run: a workflow step is not named after its persona', () => {
    const h = actorHeaders({ FLEEX_ACTOR_TYPE: 'agent', FLEEX_ACTOR_NAME: 'workflow:Spec → Build', FLEEX_ACTOR_PERSONA: 'Builder' });
    expect(h['x-fleex-actor-persona']).toBe('builder');
    // The human at the terminal has no persona, even if the variable leaked into the shell.
    expect(actorHeaders({ FLEEX_ACTOR_PERSONA: 'builder' })['x-fleex-actor-persona']).toBeUndefined();
  });

  it('lets --as override the env, persona included', () => {
    actAs('catalyst');
    expect(currentActor({ FLEEX_ACTOR_TYPE: 'agent', FLEEX_ACTOR_NAME: 'Builder', FLEEX_ACTOR_PERSONA: 'builder' }))
      .toEqual({ type: 'agent', name: 'catalyst', persona: 'catalyst' });
  });

  it('lets --as override the env', () => {
    actAs('catalyst');
    expect(actorHeaders({ FLEEX_ACTOR_TYPE: 'agent', FLEEX_ACTOR_NAME: 'Builder' })['x-fleex-actor-name']).toBe('catalyst');
  });
});

describe('linesToItems (todo add --file)', () => {
  it('makes one item per non-empty line and strips list markers', () => {
    expect(linesToItems('- Migration\n\n1. Adapters\n[ ] Routes\n  * UI  \n- [x] Done one\n')).toEqual(['Migration', 'Adapters', 'Routes', 'UI', 'Done one']);
  });
});

const todo = (assignee: TicketTodoItem['assignee']) => ({ assignee } as TicketTodoItem);
const NAS_ITEM = todo({ type: 'user', name: 'nas' });
const BUILDER_ITEM = todo({ type: 'agent', name: 'builder' });
const ANY_AGENT = todo({ type: 'agent', name: null });
const ANYONE = todo(null);

describe('todo list --mine', () => {
  it('for the human: only what is assigned to them', () => {
    const human = { type: 'user' } as const;
    expect([NAS_ITEM, BUILDER_ITEM, ANY_AGENT, ANYONE].map((i) => isMine(i, human))).toEqual([true, false, false, false]);
  });

  it('for an agent: what it may pick up — its own, any agent\'s, anyone\'s; never the human\'s', () => {
    const builder = { type: 'agent', name: 'workflow:x → Build', persona: 'builder' } as const;
    expect([NAS_ITEM, BUILDER_ITEM, ANY_AGENT, ANYONE].map((i) => isMine(i, builder))).toEqual([false, true, true, true]);
    const catalyst = { type: 'agent', name: 'Catalyst', persona: 'catalyst' } as const;
    expect(isMine(BUILDER_ITEM, catalyst)).toBe(false);
  });
});

describe('todo list --assignee', () => {
  it('matches the exact assignment', () => {
    expect([NAS_ITEM, BUILDER_ITEM, ANY_AGENT, ANYONE].map((i) => hasAssignee(i, 'user'))).toEqual([true, false, false, false]);
    expect([NAS_ITEM, BUILDER_ITEM, ANY_AGENT, ANYONE].map((i) => hasAssignee(i, 'Builder'))).toEqual([false, true, false, false]);
    expect([NAS_ITEM, BUILDER_ITEM, ANY_AGENT, ANYONE].map((i) => hasAssignee(i, 'agent'))).toEqual([false, false, true, false]);
    expect([NAS_ITEM, BUILDER_ITEM, ANY_AGENT, ANYONE].map((i) => hasAssignee(i, 'none'))).toEqual([false, false, false, true]);
  });
});

describe('the warning on another agent\'s item', () => {
  it('names the other persona, and stays quiet for the caller\'s own items and for the human', () => {
    expect(otherAgentOf(BUILDER_ITEM, { type: 'agent', name: 'Catalyst', persona: 'catalyst' })).toBe('builder');
    expect(otherAgentOf(BUILDER_ITEM, { type: 'agent', name: 'Builder', persona: 'builder' })).toBeNull();
    expect(otherAgentOf(BUILDER_ITEM, { type: 'user' })).toBeNull();
  });
});
