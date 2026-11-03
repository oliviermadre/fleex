import type { TicketTodoItem } from '@fleex/shared';

/** Caps so a long list cannot crowd the prompt. */
export const TODO_CONTEXT_OPEN_MAX = 50;
export const TODO_CONTEXT_DONE_MAX = 20;

/**
 * Always injected, list or no list: this is how an agent learns the todo exists.
 */
export const TODO_CONTEXT_HINT =
  '> This ticket has a shared todo list (`fleex ticket todo --help`). Use it for multi-step work: '
  + 'add the steps you plan, mark them done as you go (`fleex ticket todo done <ticket> <ref>`), '
  + 'never delete items you did not create — cancel them with a reason.\n';

const stamp = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '');

/**
 * The `## Todo list` section of an agent prompt, or null when the list is empty.
 * Open items first (all of them up to the cap, in list order), then the most
 * recently done ones — so the agent does not redo finished work. Cancelled
 * items are only counted.
 */
export function formatTodoContext(displayId: number, items: readonly TicketTodoItem[]): string | null {
  if (items.length === 0) return null;
  const open = items.filter((i) => i.state === 'open');
  const done = items
    .filter((i) => i.state === 'done')
    .sort((a, b) => (b.stateChangedAt ?? '').localeCompare(a.stateChangedAt ?? ''));
  const cancelled = items.filter((i) => i.state === 'cancelled').length;

  const lines = [
    '\n## Todo list\n',
    `${open.length} open · ${done.length} done · ${cancelled} cancelled — refs are per ticket: \`fleex ticket todo done ${displayId} <ref>\`.\n`,
  ];
  for (const i of open.slice(0, TODO_CONTEXT_OPEN_MAX)) {
    const reopened = i.stateChangedByName ? ` (reopened by ${i.stateChangedByName})` : '';
    lines.push(`- [ ] #${i.ref} ${i.text} — ${i.createdByName}${reopened}\n`);
  }
  if (open.length > TODO_CONTEXT_OPEN_MAX) lines.push(`- … ${open.length - TODO_CONTEXT_OPEN_MAX} more open\n`);
  for (const i of done.slice(0, TODO_CONTEXT_DONE_MAX)) {
    lines.push(`- [x] #${i.ref} ${i.text} — done by ${i.stateChangedByName ?? '?'} · ${stamp(i.stateChangedAt)}\n`);
  }
  if (done.length > TODO_CONTEXT_DONE_MAX) lines.push(`- … ${done.length - TODO_CONTEXT_DONE_MAX} more done\n`);
  if (cancelled > 0) lines.push(`(${cancelled} cancelled item${cancelled > 1 ? 's' : ''} hidden — \`fleex ticket todo list ${displayId}\`)\n`);
  return lines.join('');
}
