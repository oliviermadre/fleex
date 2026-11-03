import type { TicketTodoItem } from '@fleex/shared';

/** Caps so a long list cannot crowd the prompt. */
export const TODO_CONTEXT_OPEN_MAX = 50;
export const TODO_CONTEXT_DONE_MAX = 20;

/**
 * Always injected, list or no list: this is how an agent learns the todo exists
 * — and that an item assigned to the human is not its to take.
 */
export const TODO_CONTEXT_HINT =
  '> This ticket has a shared todo list (`fleex ticket todo --help`). Use it for multi-step work: '
  + 'add the steps you plan, mark them done as you go (`fleex ticket todo done <ticket> <ref>`), '
  + 'never delete items you did not create — cancel them with a reason. '
  + 'Items have an assignee: work on yours and unassigned ones; **never act on items assigned to the human** '
  + 'unless they explicitly ask you to take them over (`todo assign … me --reason`). '
  + 'Assign to the human (`--to user`) what only they can do: manual QA, decisions, credentials.\n';

/** Who reads the prompt: the run's persona slug, if it has one. */
export interface TodoContextViewer {
  persona?: string;
}

const stamp = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '');

type Group = 'mine' | 'anyone' | 'other' | 'human';

/** Which group an open item falls in, from the viewer's point of view. */
function groupOf(i: TicketTodoItem, viewer: TodoContextViewer): Group {
  const a = i.assignee;
  if (!a || (a.type === 'agent' && !a.name)) return 'anyone';
  if (a.type === 'user') return 'human';
  return viewer.persona && a.name?.toLowerCase() === viewer.persona.toLowerCase() ? 'mine' : 'other';
}

/**
 * The `## Todo list` section of an agent prompt, or null when the list is empty.
 *
 * Open items (all of them up to the cap, in list order) are grouped by who
 * they are for, from the run's point of view: for you, for anyone, for
 * another agent, for the human — the last group says plainly not to act on
 * them. Then the most recently done ones, so the agent does not redo finished
 * work. Cancelled items are only counted.
 */
export function formatTodoContext(
  displayId: number,
  items: readonly TicketTodoItem[],
  viewer: TodoContextViewer = {},
): string | null {
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

  const shown = open.slice(0, TODO_CONTEXT_OPEN_MAX);
  const humanName = shown.find((i) => i.assignee?.type === 'user')?.assignee?.name ?? 'the human';
  const headings: Record<Group, string> = {
    mine: `### For you (${viewer.persona ?? 'you'})`,
    anyone: '### For any agent / anyone',
    other: "### Assigned to another agent — coordinate, don't take silently",
    human: `### Assigned to ${humanName} — do NOT act on these`,
  };
  for (const group of ['mine', 'anyone', 'other', 'human'] as const) {
    const inGroup = shown.filter((i) => groupOf(i, viewer) === group);
    if (inGroup.length === 0) continue;
    lines.push(`${headings[group]}\n`);
    for (const i of inGroup) {
      const reopened = i.stateChangedByName ? ` (reopened by ${i.stateChangedByName})` : '';
      const to = group === 'other' ? ` → ${i.assignee?.name}` : '';
      const takeover = i.takeoverReason ? ` (taken over by ${i.assignedByName}: “${i.takeoverReason}”)` : '';
      lines.push(`- [ ] #${i.ref} ${i.text} — by ${i.createdByName}${to}${reopened}${takeover}\n`);
    }
  }
  if (open.length > TODO_CONTEXT_OPEN_MAX) lines.push(`- … ${open.length - TODO_CONTEXT_OPEN_MAX} more open\n`);

  if (done.length > 0 && shown.length > 0) lines.push('### Done\n');
  for (const i of done.slice(0, TODO_CONTEXT_DONE_MAX)) {
    lines.push(`- [x] #${i.ref} ${i.text} — done by ${i.stateChangedByName ?? '?'} · ${stamp(i.stateChangedAt)}\n`);
  }
  if (done.length > TODO_CONTEXT_DONE_MAX) lines.push(`- … ${done.length - TODO_CONTEXT_DONE_MAX} more done\n`);
  if (cancelled > 0) lines.push(`(${cancelled} cancelled item${cancelled > 1 ? 's' : ''} hidden — \`fleex ticket todo list ${displayId}\`)\n`);
  return lines.join('');
}
