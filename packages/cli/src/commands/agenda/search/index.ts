import type { CommandDef } from '../../../core/types.ts';
import { die, info, present, warn } from '../../../core/colors.ts';
import { describeAgendaError } from '../_shared.ts';
import {
  addDays, addFilterOptions, attendeeHint, buildFilter, calendarsToRead, dayKey, defaultSearchRange, itemLine, itemMatchKind, parseDateArg,
  searchAgenda, summarize, type ItemFilterOptions,
} from '../_read.ts';

interface SearchOptions extends ItemFilterOptions { since?: string; until?: string; limit?: string; calendar?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'search',
  description:
    'Find agenda items over a long period (no window limit), nearest to today first: by text (--q), by meeting guest (--attendee) and/or type. ' +
    'Without --since/--until it looks one year back and three months ahead, and says which period it covered. ' +
    'If the request does not say when and several items match, ask the user which one (or which period) instead of picking one. A guest name with a typo still finds near spellings: those results come back flagged approximate — confirm the person with the user.',
  setup(cmd) {
    cmd.option('--since <date>', 'Search from this day (YYYY-MM-DD or ISO). Default: one year ago');
    cmd.option('--until <date>', 'Search up to this day, inclusive (YYYY-MM-DD or ISO). Default: three months ahead');
    cmd.option('--limit <n>', 'Stop after this many matches (default 10)');
    addFilterOptions(cmd);
  },
  action: async (opts: SearchOptions) => {
    if (!opts.q && !opts.attendee && !opts.type) die('Say what to look for: --q <text>, --attendee <who> and/or --type <types>.');
    const range = defaultSearchRange();
    if (opts.since) {
      const s = parseDateArg(opts.since);
      if (!s) die(`Invalid --since "${opts.since}" (YYYY-MM-DD or ISO 8601).`);
      range.since = s.at;
    }
    if (opts.until) {
      const u = parseDateArg(opts.until);
      if (!u) die(`Invalid --until "${opts.until}" (YYYY-MM-DD or ISO 8601).`);
      range.until = u.isDay ? addDays(u.at, 1) : u.at;
    }
    if (range.until <= range.since) die('--until must be after --since.');
    const limit = opts.limit ? Number(opts.limit) : 10;
    if (!Number.isInteger(limit) || limit < 1) die(`Invalid --limit "${opts.limit}" (a positive integer).`);
    const filter = await buildFilter(opts);
    if ('error' in filter) die(filter.error);
    let out;
    try {
      out = await searchAgenda((i) => itemMatchKind(i, filter), range, limit, await calendarsToRead(opts.calendar));
    } catch (err) {
      die(describeAgendaError(err));
    }
    const covered = { since: dayKey(out.covered.since), until: dayKey(new Date(out.covered.until.getTime() - 1)) };
    const hint = filter.attendee && out.items.length === 0 ? attendeeHint(filter.attendee) : undefined;
    const approxNote = out.approximate ? `No exact match for "${filter.attendee}": these are near spellings — confirm with the user.` : undefined;
    present({
      ok: true, count: out.items.length, covered, approximate: out.approximate || undefined, note: approxNote, hint,
      items: out.items.map((i) => summarize(i, filter.attendee)), errors: out.errors,
    }, () => {
      for (const e of out.errors) warn(`Source unavailable — ${e}`);
      if (approxNote) warn(approxNote);
      if (hint) warn(hint);
      info(`Searched ${covered.since} → ${covered.until}: ${out.items.length} match${out.items.length === 1 ? '' : 'es'}${out.items.length >= limit ? ` (stopped at --limit ${limit})` : ''}.`);
      for (const it of out.items) {
        const m = summarize(it, filter.attendee).match;
        process.stdout.write(`${itemLine(it)}${m ? `\n    ≈ ${m.attendee}` : ''}\n`);
      }
    });
  },
};

export default def;
