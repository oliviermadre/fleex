/**
 * Who the CLI acts as, sent to the server as `x-fleex-actor-*` headers.
 *
 * - An agent run exports FLEEX_ACTOR_TYPE=agent + FLEEX_ACTOR_NAME (see the
 *   server's buildSdkOptions): what it writes is attributed to it.
 * - `--as <name>` forces an agent attribution by hand (a human driving an
 *   interactive Claude Code).
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

export function actorHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const headers: Record<string, string> = { 'x-fleex-source': env.FLEEX_SOURCE === 'mcp' ? 'mcp' : 'cli' };
  const name = asOverride ?? (env.FLEEX_ACTOR_TYPE === 'agent' ? env.FLEEX_ACTOR_NAME?.trim() : undefined);
  if (name) {
    headers['x-fleex-actor-type'] = 'agent';
    headers['x-fleex-actor-name'] = encodeURIComponent(name);
  }
  return headers;
}
