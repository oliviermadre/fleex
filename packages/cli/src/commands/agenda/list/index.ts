import type { CommandDef } from '../../../core/types.ts';
import { die, info, present, warn } from '../../../core/colors.ts';
import { describeAgendaError } from '../_shared.ts';
import {
  WINDOW_SHORTCUTS, addFilterOptions, attendeeHint, buildFilter, calendarsToRead, dayKey, fetchAgenda, itemLine, pickMatches,
  resolveWindow, summarize, type ItemFilterOptions,
} from '../_read.ts';

interface ListOptions extends ItemFilterOptions { from?: string; to?: string; calendar?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description:
    'Read the agenda over a window (≤ 42 days): Google meetings, free events, ticket created/done/due, routine runs and slots, ' +
    'workflow and agent runs, merged PRs. Each line carries a ref (ag_…) that `agenda show`, `link`, `links` and `respond` accept as-is. ' +
    'Default window: today. For a meeting whose date is unknown, use `agenda search`.',
  setup(cmd) {
    cmd.argument('[when]', `Shortcut window: ${WINDOW_SHORTCUTS.join(', ')}`);
    cmd.option('--from <date>', 'Window start: YYYY-MM-DD (local midnight) or ISO 8601');
    cmd.option('--to <date>', 'Window end: YYYY-MM-DD (inclusive day) or ISO 8601. Default: one day after --from');
    addFilterOptions(cmd);
  },
  action: async (when: string | undefined, opts: ListOptions) => {
    const w = resolveWindow({ when, from: opts.from, to: opts.to });
    if ('error' in w) die(w.error);
    const filter = await buildFilter(opts);
    if ('error' in filter) die(filter.error);
    let items;
    let approximate = false;
    let errors: Record<string, string | undefined> = {};
    try {
      const res = await fetchAgenda(w.from, w.to, await calendarsToRead(opts.calendar));
      ({ items, approximate } = pickMatches(res.items, filter));
      errors = res.errors;
    } catch (err) {
      die(describeAgendaError(err));
    }
    const failed = Object.entries(errors).filter(([, e]) => e).map(([k, e]) => `${k}: ${e}`);
    const hint = filter.attendee && items.length === 0 ? attendeeHint(filter.attendee) : undefined;
    const note = approximate ? `No exact match for "${filter.attendee}": these are near spellings — confirm with the user.` : undefined;
    present({
      ok: true, from: w.from.toISOString(), to: w.to.toISOString(), count: items.length, approximate: approximate || undefined, note, hint,
      items: items.map((i) => summarize(i, filter.attendee)), errors: failed,
    }, () => {
      for (const f of failed) warn(`Source unavailable — ${f}`);
      if (note) warn(note);
      if (hint) warn(hint);
      if (items.length === 0) {
        info(`Nothing between ${dayKey(w.from)} and ${dayKey(new Date(w.to.getTime() - 1))}.`);
        return;
      }
      for (const it of items) {
        const m = summarize(it, filter.attendee).match;
        process.stdout.write(`${itemLine(it)}${m ? `\n    ≈ ${m.attendee}` : ''}\n`);
      }
    });
  },
};

export default def;
