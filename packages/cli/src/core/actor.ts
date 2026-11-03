/**
 * Who the CLI acts as, sent to the server as `x-fleex-actor-*` headers.
 *
 * - An agent run exports FLEEX_ACTOR_TYPE=agent + FLEEX_ACTOR_NAME (see the
 *   server's buildSdkOptions): what it writes is attributed to it. It also
 *   exports FLEEX_ACTOR_PERSONA (its persona slug), which tells the server
 *   which todo items are assigned to this run and what `me` means.
 * - `--as <name>` forces an agent attribution by hand (a human driving an
 *   interactive Claude Code); a slug-shaped name doubles as the persona.
 * - Otherwise: no actor header — the server attributes to the configured human.
 *
 * The source is `mcp` when the MCP server spawned us (it sets FLEEX_SOURCE=mcp),
 * `cli` otherwise. The name is URL-encoded: headers are latin-1 only and a
 * workflow step is named `workflow:<template> → <step>`.
 *
 * Only the todo routes read these headers today; other routes ignore them.
 */
let asOverride: string | undefined;

/** `--as <name>`: attribute this command's writes to agent `<name>`. */
export function actAs(name: string | undefined): void {
  const trimmed = name?.trim();
  asOverride = trimmed ? trimmed : undefined;
}

const SLUG = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;

/** Who this CLI process acts as: the human, or an agent (with its persona slug when known). */
export type CliActor = { type: 'user' } | { type: 'agent'; name: string; persona?: string };

export function currentActor(env: NodeJS.ProcessEnv = process.env): CliActor {
  if (asOverride) return { type: 'agent', name: asOverride, ...(SLUG.test(asOverride) ? { persona: asOverride.toLowerCase() } : {}) };
  const name = env.FLEEX_ACTOR_TYPE === 'agent' ? env.FLEEX_ACTOR_NAME?.trim() : undefined;
  if (!name) return { type: 'user' };
  const persona = env.FLEEX_ACTOR_PERSONA?.trim().toLowerCase();
  return { type: 'agent', name, ...(persona && SLUG.test(persona) ? { persona } : {}) };
}

export function actorHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const headers: Record<string, string> = { 'x-fleex-source': env.FLEEX_SOURCE === 'mcp' ? 'mcp' : 'cli' };
  const actor = currentActor(env);
  if (actor.type === 'agent') {
    headers['x-fleex-actor-type'] = 'agent';
    headers['x-fleex-actor-name'] = encodeURIComponent(actor.name);
    if (actor.persona) headers['x-fleex-actor-persona'] = actor.persona;
  }
  return headers;
}
