import type { Command } from 'commander';
import type { TicketTodoEvent, TicketTodoItem, TodoWriteResult } from '@fleex/shared';
import { c, err, ok, info, present } from '../../../core/colors.ts';
import { apiBase, apiCall } from '../../../core/api.ts';
import { actAs } from '../../../core/actor.ts';

export const BOARD_OPTION: [string, string] = ['--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)'];

/** `--as <name>` on every write command. */
export function addAsOption(cmd: Command): void {
  cmd.option('--as <name>', 'Attribute this change to agent <name> (default: FLEEX_ACTOR_NAME of an agent run, else you)');
}

/** Apply `--as` before any request is sent. */
export function applyAs(opts: { as?: string }): void {
  actAs(opts.as);
}

export function todosUrl(ticketUuid: string, item?: string): string {
  const base = `${apiBase()}/api/tickets/${ticketUuid}/todos`;
  return item === undefined ? base : `${base}/${encodeURIComponent(item.replace(/^#/, ''))}`;
}

/** `3 Nov 10:41`, local time. */
export function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const BOX: Record<TicketTodoItem['state'], string> = { open: '[ ]', done: '[x]', cancelled: '[-]' };

/** One line of `todo list`: box, ref, text, then who/when. */
export function itemLine(i: TicketTodoItem, textWidth = 48): string {
  const meta = i.state === 'open'
    ? `${i.createdByName} · ${shortDate(i.createdAt)}${i.stateChangedByName ? ` · reopened by ${i.stateChangedByName}` : ''}`
    : `${i.state === 'done' ? 'done' : 'cancelled'} by ${i.stateChangedByName ?? '?'} · ${shortDate(i.stateChangedAt)}`
      + (i.cancelReason ? ` — “${i.cancelReason}”` : '');
  const label = `${`#${i.ref}`.padEnd(4)} ${i.text}`;
  const cut = label.length > textWidth ? `${label.slice(0, textWidth - 1)}…` : label.padEnd(textWidth);
  const body = i.state === 'open' ? cut : c.dim(cut);
  return `  ${BOX[i.state]} ${body}  ${c.dim(meta)}${i.note ? c.dim(' 📝') : ''}`;
}

/** open first (list order), then done, then cancelled. */
export function displayOrder(items: TicketTodoItem[]): TicketTodoItem[] {
  return [
    ...items.filter((i) => i.state === 'open'),
    ...items.filter((i) => i.state === 'done'),
    ...items.filter((i) => i.state === 'cancelled'),
  ];
}

export function countsLine(items: TicketTodoItem[]): string {
  const n = (s: TicketTodoItem['state']) => items.filter((i) => i.state === s).length;
  return `${n('open')} open · ${n('done')} done · ${n('cancelled')} cancelled`;
}

/** Report a write honestly: "already done" when the server wrote nothing. */
export function reportWrite(result: TodoWriteResult, verb: string, noopVerb = verb): void {
  if (result.history.length === 0) info(`#${result.item.ref} already ${noopVerb} — nothing written`);
  else ok(`#${result.item.ref} ${verb}`);
}

export function historyLine(e: TicketTodoEvent, withRef: boolean): string {
  const ref = withRef ? `${c.dim(`#${e.itemRef}`)} ` : '';
  const what = describeEvent(e);
  return `  ${c.dim(shortDate(e.createdAt).padEnd(13))} ${c.cyan(e.actorName.padEnd(12))} ${ref}${what} ${c.dim(`(${e.source})`)}`;
}

function describeEvent(e: TicketTodoEvent): string {
  const ch = e.changes as Record<string, { from: unknown; to: unknown }>;
  switch (e.action) {
    case 'created': return `created “${e.itemText}”`;
    case 'deleted': return 'deleted';
    case 'moved': return 'moved';
    case 'state_changed':
      return `state ${String(ch.state?.from)} → ${String(ch.state?.to)}${ch.reason ? ` — “${String(ch.reason.to)}”` : ''}`;
    case 'edited':
      return Object.entries(ch)
        .map(([k, v]) => `${k} “${String(v.from ?? '∅')}” → “${String(v.to ?? '∅')}”`)
        .join(', ');
  }
}

/** One item per non-empty line; list markers (`- `, `1. `, `[ ] `) are stripped. */
export function linesToItems(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?/, '').trim())
    .filter((l) => l.length > 0);
}


/**
 * done / cancel / reopen on one or several refs. Every ref is tried; the
 * command fails (exit 1) if any of them failed, after reporting each one.
 */
export async function changeState(
  ticketArg: string,
  refs: string[],
  state: 'open' | 'done' | 'cancelled',
  opts: { board?: string; as?: string; reason?: string },
  resolveTicketId: (arg: string, board?: string) => Promise<string>,
): Promise<void> {
  applyAs(opts);
  const uuid = await resolveTicketId(ticketArg, opts.board);
  const results: TodoWriteResult[] = [];
  const failures: string[] = [];
  for (const ref of refs) {
    try {
      results.push(await apiCall<TodoWriteResult>('PATCH', todosUrl(uuid, ref), {
        state,
        ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      }));
    } catch (e) {
      failures.push(`#${ref.replace(/^#/, '')}: ${e instanceof Error ? e.message.replace(/^HTTP \d+: /, '') : String(e)}`);
    }
  }
  const verb = state === 'open' ? 'reopened' : state;
  const noop = state === 'open' ? 'open' : state;
  present(results.length === 1 && failures.length === 0 ? results[0] : { results, failures }, () => {
    for (const r of results) reportWrite(r, verb, noop);
    for (const f of failures) err(f);
  });
  if (failures.length > 0) process.exit(1);
}
