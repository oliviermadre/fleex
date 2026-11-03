import type { TodoActorType, TodoSource } from '@fleex/shared';
import { isTodoSource } from '@fleex/shared';
import type { TodoActor } from '../../application/use-cases/ticket-todos.js';

const NAME_MAX = 120;

type HeaderBag = Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string | undefined {
  const v = headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

/** The CLI URL-encodes the name (headers are latin-1; step names hold `→`). */
function decode(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/**
 * Who is acting on a web (`/api/tickets/...`) todo route.
 *
 * The CLI — and the MCP, which runs the CLI — declare themselves with
 * `x-fleex-actor-type` / `x-fleex-actor-name` / `x-fleex-source`, set from
 * the FLEEX_ACTOR_* env an agent run receives (or `--as`). Without headers the
 * caller is the browser: the configured human, source `web`.
 *
 * Declarative on purpose: the local CLI is already trusted. This serves
 * reading the history, not security. Bad values fall back to the human.
 */
export function resolveTodoActor(headers: HeaderBag, human: string): TodoActor {
  const rawSource = header(headers, 'x-fleex-source');
  const source: TodoSource = rawSource && isTodoSource(rawSource) && rawSource !== 'agent-api' ? rawSource : 'web';
  const rawType = header(headers, 'x-fleex-actor-type');
  const rawName = decode(header(headers, 'x-fleex-actor-name'))?.trim().slice(0, NAME_MAX);
  if (rawType === 'agent' && rawName) return { type: 'agent', name: rawName, source };
  const type: TodoActorType = 'user';
  return { type, name: rawType === 'user' && rawName ? rawName : human, source };
}
