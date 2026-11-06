import { agendaItemLinkKey, findByTitle, isLinkableAgendaItem, type AgendaItem } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { die, info, ok, present } from '../../../core/colors.ts';
import { apiBase } from '../../../core/api.ts';
import { agendaRequest, describeAgendaError, formatLink, type AgendaExternalLink } from '../_shared.ts';
import { addDays, calendarsToRead, fetchAgenda, parseDateArg, refOf, resolveItem, whenOf } from '../_read.ts';

export interface LinkOptions {
  deliverable?: string;
  item?: string;
  googleEvent?: string;
  matchTitle?: string;
  date?: string;
  calendar?: string;
}

/**
 * Which meeting the flags designate, or why they don't. `body` is what
 * `POST /api/agenda/google/link` takes for --google-event.
 */
export function buildLinkBody(opts: LinkOptions): { body: Record<string, string> } | { error: string } {
  if (!opts.deliverable) return { error: 'Missing --deliverable <id>.' };
  const ways = [Boolean(opts.item), Boolean(opts.googleEvent), Boolean(opts.matchTitle || opts.date)].filter(Boolean).length;
  if (ways > 1) return { error: 'Use one of --item, --google-event, or --match-title with --date — not both.' };
  if (opts.item) return { body: { deliverableId: opts.deliverable, item: opts.item } };
  if (!opts.googleEvent && !(opts.matchTitle && opts.date)) {
    return { error: 'Say which meeting: --item <ref>, --google-event <id>, or --match-title "<title>" --date YYYY-MM-DD.' };
  }
  if (opts.date && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) return { error: `Invalid --date "${opts.date}" (expected YYYY-MM-DD).` };
  const body: Record<string, string> = { deliverableId: opts.deliverable };
  if (opts.googleEvent) body['googleEventId'] = opts.googleEvent;
  if (opts.matchTitle) body['matchTitle'] = opts.matchTitle;
  if (opts.date) body['date'] = opts.date;
  if (opts.calendar) body['calendarId'] = opts.calendar;
  return { body };
}

/** The Google meetings and free events of a day whose title matches. */
export function matchMeetings(items: AgendaItem[], title: string): AgendaItem[] {
  const seen = new Set<string>();
  const linkable = items.filter((i) => {
    if (!isLinkableAgendaItem(i)) return false;
    const key = agendaItemLinkKey(i)!;
    if (seen.has(key)) return false; // the same meeting seen from two calendars
    seen.add(key);
    return true;
  });
  return findByTitle(linkable, title, (i) => i.title);
}

async function linkItem(item: AgendaItem, deliverableId: string) {
  const eventKey = agendaItemLinkKey(item);
  if (!eventKey) die(`A deliverable links to a Google meeting or a free event, not to a ${item.type} item.`);
  return agendaRequest<AgendaExternalLink>('POST', `${apiBase()}/api/agenda/external-links`, {
    eventKey, deliverableId, eventTitle: item.title, eventStart: item.start, source: 'cli',
  });
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'link',
  description:
    'Link a deliverable to a meeting — a Google Calendar meeting or a free Fleex event (one occurrence of a repeating one). ' +
    'Designate it by its agenda ref (--item, from `agenda list` / `search`), by Google event id, or by title on a day. Linking twice is a no-op.',
  setup(cmd) {
    cmd.option('--deliverable <id>', 'Deliverable UUID (required; find it with `fleex deliverable search`)');
    cmd.option('--item <ref>', 'Agenda item ref (ag_… from `agenda list` / `search`), or event:<id> for a free event');
    cmd.option('--google-event <id>', 'Google Calendar event id (an occurrence id for one meeting of a series)');
    cmd.option('--match-title <title>', 'Meeting or event title to look for on --date (case, accents, emojis and punctuation ignored; either title may contain the other)');
    cmd.option('--date <YYYY-MM-DD>', 'Day of the meeting, local time (with --match-title)');
    cmd.option('--calendar <id>', 'Google calendar id (default: the calendars picked in the agenda preferences; with --google-event: primary)');
  },
  action: async (opts: LinkOptions) => {
    const built = buildLinkBody(opts);
    if ('error' in built) die(built.error);
    let res: { status: number; data: AgendaExternalLink };
    try {
      if (opts.googleEvent) {
        res = await agendaRequest<AgendaExternalLink>('POST', `${apiBase()}/api/agenda/google/link`, built.body);
      } else if (opts.item) {
        const r = await resolveItem(opts.item, await calendarsToRead(opts.calendar));
        if ('error' in r) die(r.error);
        res = await linkItem(r.item, opts.deliverable!);
      } else {
        const day = parseDateArg(opts.date!);
        if (!day) die(`Invalid --date "${opts.date}".`);
        const agenda = await fetchAgenda(day.at, addDays(day.at, 1), await calendarsToRead(opts.calendar));
        const found = matchMeetings(agenda.items, opts.matchTitle!);
        if (found.length === 0) {
          const gerr = agenda.errors.external ? ` (Google Calendar unavailable: ${agenda.errors.external})` : '';
          die(`No meeting or event matching "${opts.matchTitle}" on ${opts.date}${gerr}.`);
        }
        if (found.length > 1) {
          die(`${found.length} meetings match "${opts.matchTitle}" on ${opts.date} — retry with --item <ref>:${found.map((f) => `\n  ${refOf(f)}  ${whenOf(f)}  ${f.title}`).join('')}`);
        }
        res = await linkItem(found[0]!, opts.deliverable!);
      }
    } catch (err) {
      die(describeAgendaError(err));
    }
    const created = res.status === 201;
    present({ ok: true, created, link: res.data }, () => {
      if (created) ok(`Linked: ${formatLink(res.data)}`);
      else info(`Already linked: ${formatLink(res.data)}`);
    });
  },
};

export default def;
