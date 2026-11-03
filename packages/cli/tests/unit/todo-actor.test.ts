/**
 * The CLI's half of todo attribution: an agent run must be credited for what
 * it writes, the human must stay the default, and the source must say whether
 * the MCP or the CLI did it — that is what the todo history shows.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { actAs, actorHeaders } from '../../src/core/actor.ts';
import { linesToItems } from '../../src/commands/ticket/todo/_shared.ts';

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
