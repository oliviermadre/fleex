/**
 * What every `fleex factory` command shares: the routes, how a ticket, an item or a machine is named on the command
 * line, and how each is shown.
 *
 * The floor is read through the routes made for whoever operates it without the page (`/api/factory/overview`,
 * `/needs`, `/tickets`, `/machines`: see the server's `factory/operate.ts`), never through `/state`: that one carries
 * the whole layout, thousands of belt tiles, which no command and no tool call should print.
 */
import { c, die, err, ok, present } from '../../core/colors.ts';
import { apiBase, apiCall, apiGet } from '../../core/api.ts';
import { matchById } from '../../core/match.ts';
import { trunc } from '../../core/agentic.ts';

export const fx = (path: string): string => `${apiBase()}/api/factory${path}`;
export const enc = encodeURIComponent;

export type NeedKind = 'decision' | 'question' | 'failed' | 'aside' | 'floor' | 'zone';

/** A ticket or an item on the floor, as `/api/factory/tickets` gives it. */
export interface FloorToken {
  id: string; kind: 'ticket' | 'item'; displayId: number | null; title: string;
  type: string; priority: string; status: string | null; tags: string[];
  source?: string; author?: string; url?: string | null;
  machineId: string | null; where: string; phase: string; state: string;
  outcome: string; released: boolean; note: string; since: string; handedAt: string;
  need: NeedKind | null; actions: string[]; outcomes: string[];
}
export interface Need { token: FloorToken; kind: NeedKind; label: string; waitMs: number }

/** A machine, as `/api/factory/machines` gives it. */
export interface FloorMachine {
  id: string; kind: string; name: string; x: number; y: number; w: number; h: number;
  exec?: string; ref?: string; off?: boolean; gap?: string | null; dir?: string;
  source?: string; dropped?: number; pulledAt?: string | null; pullError?: string | null;
  holds: number; needs: number;
}
export interface MachineDetail extends FloorMachine { spec: Record<string, unknown>; tokens: FloorToken[] }

export const fetchTokens = (): Promise<FloorToken[]> => apiGet<FloorToken[]>(fx('/tickets'));
export const fetchMachines = (): Promise<FloorMachine[]> => apiGet<FloorMachine[]>(fx('/machines'));
export const fetchToken = (id: string): Promise<FloorToken> => apiGet<FloorToken>(fx(`/tickets/${enc(id)}`));
export const fetchMachine = (id: string): Promise<MachineDetail> => apiGet<MachineDetail>(fx(`/machines/${enc(id)}`));

/** How a ticket or an item is written in a table and typed back: `#42` for a ticket, the first 8 characters of its id for an item. */
export const refOf = (t: Pick<FloorToken, 'kind' | 'displayId' | 'id'>): string => (t.kind === 'ticket' && t.displayId != null ? `#${t.displayId}` : t.id.slice(0, 8));

const tokenLine = (t: FloorToken): string => `  ${refOf(t).padEnd(9)} ${trunc(t.title, 50)}  ${c.dim(`${t.where} · ${t.id}`)}\n`;

/**
 * Find a ticket or an item of the floor from what was typed: a ticket's number (`42`, `#42`), a full id, or the start
 * of one (what the tables show for an item). Anything that matches several is refused with the list, never guessed.
 */
export function pickToken(tokens: readonly FloorToken[], ref: string, kind?: 'ticket' | 'item'): FloorToken {
  const pool = kind ? tokens.filter((t) => t.kind === kind) : tokens, what = kind ?? 'ticket or item';
  const needle = ref.trim().replace(/^#/, '');
  if (!needle) die(`A ${what} is required.`);
  let matches: FloorToken[] = [];
  if (/^\d+$/.test(needle)) matches = pool.filter((t) => t.displayId === Number(needle));
  if (!matches.length) {
    const byId = matchById(pool, needle);
    matches = byId.kind === 'found' ? [byId.item] : byId.kind === 'ambiguous' ? byId.matches : [];
  }
  if (matches.length === 1) return matches[0]!;
  if (!matches.length) {
    die(`No ${what} on the factory floor matches "${ref}". Run \`fleex factory ${kind === 'item' ? 'item' : 'ticket'} list\` to see them`
      + (kind === 'item' ? ' (`fleex factory item archived` for those that left).' : ', or `fleex factory ticket send` to hand a ticket over.'));
  }
  err(`"${ref}" matches several on the floor — use the full id:`);
  for (const t of matches) process.stderr.write(tokenLine(t));
  process.exit(1);
}

export async function resolveToken(ref: string, kind?: 'ticket' | 'item'): Promise<FloorToken> {
  return pickToken(await fetchTokens(), ref, kind);
}

/**
 * Find a machine from what was typed: its id, the start of its id, or its name (case does not matter). Belts, bridges
 * and arms have no name of their own: they are found by id only.
 */
export function pickMachine(machines: readonly FloorMachine[], ref: string, kinds?: readonly string[]): FloorMachine {
  const pool = kinds ? machines.filter((m) => kinds.includes(m.kind)) : machines, what = kinds ? kinds.join(' or ') : 'machine';
  const needle = ref.trim();
  if (!needle) die(`A ${what} is required.`);
  const byId = matchById(pool, needle);
  if (byId.kind === 'found') return byId.item;
  let matches = byId.kind === 'ambiguous' ? byId.matches : [];
  if (!matches.length) {
    const named = pool.filter((m) => !['belt', 'bridge', 'arm'].includes(m.kind));
    matches = named.filter((m) => m.name.toLowerCase() === needle.toLowerCase());
    if (!matches.length) matches = named.filter((m) => m.name.toLowerCase().startsWith(needle.toLowerCase()));
  }
  if (matches.length === 1) return matches[0]!;
  if (!matches.length) die(`No ${what} on the factory floor matches "${ref}". Run \`fleex factory machine list\` to see them.`);
  err(`"${ref}" matches several machines — use an id:`);
  for (const m of matches) process.stderr.write(`  ${m.id.slice(0, 8)}  ${m.kind.padEnd(10)} ${m.name}  ${c.dim(`at ${m.x},${m.y}`)}\n`);
  process.exit(1);
}

export async function resolveMachine(ref: string, kinds?: readonly string[]): Promise<FloorMachine> {
  return pickMachine(await fetchMachines(), ref, kinds);
}

export const DIRS = ['east', 'south', 'west', 'north'] as const;
/** A direction as the layout holds it (0 east, 1 south, 2 west, 3 north), from a word, its first letter or the number. */
export function parseDir(input: string): 0 | 1 | 2 | 3 {
  const v = input.trim().toLowerCase();
  const i = /^[0-3]$/.test(v) ? Number(v) : DIRS.findIndex((d) => d === v || d[0] === v);
  if (i < 0) die(`Invalid direction: ${input} (valid: ${DIRS.join(', ')}, or 0 to 3)`);
  return i as 0 | 1 | 2 | 3;
}

/** A whole number from an option, or a refusal that names the option. */
export function parseInteger(input: string, option: string): number {
  if (!/^-?\d+$/.test(input.trim())) die(`${option} takes a whole number (got "${input}")`);
  return Number(input.trim());
}

/** A JSON object from an option, or a refusal that names the option. */
export function parseObject(input: string, option: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(input); } catch (e) { die(`${option} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) die(`${option} takes a JSON object, like '{"cap": 2}'`);
  return value as Record<string, unknown>;
}

/** Where to put a ticket, from `--to <machine>` or `--x`/`--y`; undefined when neither was given. */
export async function resolveTarget(opts: { to?: string; x?: string; y?: string }): Promise<{ machineId: string } | { x: number; y: number } | undefined> {
  if (opts.to !== undefined && (opts.x !== undefined || opts.y !== undefined)) die('--to is exclusive with --x/--y.');
  if (opts.to !== undefined) return { machineId: (await resolveMachine(opts.to)).id };
  if (opts.x === undefined && opts.y === undefined) return undefined;
  if (opts.x === undefined || opts.y === undefined) die('A tile needs both --x and --y.');
  return { x: parseInteger(opts.x, '--x'), y: parseInteger(opts.y, '--y') };
}

/** "3 min", "2 h", "4 d": how long something has waited. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} d`;
}
export const since = (iso: string | null | undefined): string => (iso && Date.parse(iso) ? ago(Date.now() - Date.parse(iso)) : '-');

/** A ticket or an item where it stands, as the lines every command that acted on one ends with. */
export function printToken(t: FloorToken): void {
  const w = (label: string, value: string) => process.stdout.write(`  ${c.dim(label.padEnd(9))} ${value}\n`);
  process.stdout.write(`${c.bold(refOf(t))} ${t.title}\n`);
  w('id', t.id);
  if (t.kind === 'item') w('from', `${t.source ?? ''}${t.author ? ` · ${t.author}` : ''}`);
  else w('ticket', [t.status, t.type, t.priority].filter(Boolean).join(' · ') || '-');
  w('where', `${t.where}${t.machineId ? c.dim(`  (${t.machineId.slice(0, 8)})`) : ''}`);
  w('state', `${t.state}${c.dim(`  for ${since(t.since)}`)}`);
  if (t.note && t.note !== t.state) w('note', trunc(t.note.replace(/\s+/g, ' '), 200));
  if (t.need) w('waits for', c.yellow(t.need === 'zone' ? 'you (a zone of work done by hand)' : t.need === 'floor' ? 'a machine to be put on' : t.need === 'aside' ? 'being put back' : t.need === 'failed' ? 'a look at its failed run' : `a ${t.need}`));
  if (t.outcomes.length) w('outcomes', t.outcomes.join(', '));
  w('can', t.actions.join(', '));
}

/**
 * Do something to a ticket or an item of the floor, then say where it stands now: every command that acts on one
 * answers with the same reading (`FloorToken`), so what to do next is in the answer.
 */
export async function actOn(ref: string, act: (t: FloorToken) => Promise<unknown>, done: string, kind?: 'ticket' | 'item'): Promise<void> {
  const before = await resolveToken(ref, kind);
  await act(before);
  // Moved into an exit, it has already left: that is an answer, not a failure of the command.
  const after = await apiCall<FloorToken>('GET', fx(`/tickets/${enc(before.id)}`)).catch(() => null);
  if (!after) {
    present({ id: before.id, kind: before.kind, displayId: before.displayId, title: before.title, onFloor: false }, () =>
      ok(`${done}: ${refOf(before)} — it has left the floor (\`fleex factory exits\` lists what left)`));
    return;
  }
  present(after, () => { ok(`${done}: ${refOf(after)}`); printToken(after); });
}

/** The rows of a table of tickets and items. */
export function tokenRows(tokens: readonly FloorToken[]): string[][] {
  return tokens.map((t) => [refOf(t), trunc(t.title, 44), trunc(t.where, 22), trunc(t.state, 40), since(t.since), t.need ? c.yellow(t.need) : '-']);
}
export const TOKEN_HEADERS = ['REF', 'TITLE', 'WHERE', 'STATE', 'FOR', 'WAITS FOR'];
