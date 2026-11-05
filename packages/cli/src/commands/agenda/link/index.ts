import type { CommandDef } from '../../../core/types.ts';
import { die, info, ok, present } from '../../../core/colors.ts';
import { apiBase } from '../../../core/api.ts';
import { agendaRequest, describeAgendaError, formatLink, type AgendaExternalLink } from '../_shared.ts';

export interface LinkOptions {
  deliverable?: string;
  googleEvent?: string;
  matchTitle?: string;
  date?: string;
  calendar?: string;
}

/** The body of `POST /api/agenda/google/link`, or the reason the flags don't make one. */
export function buildLinkBody(opts: LinkOptions): { body: Record<string, string> } | { error: string } {
  if (!opts.deliverable) return { error: 'Missing --deliverable <id>.' };
  const byId = Boolean(opts.googleEvent);
  const byTitle = Boolean(opts.matchTitle || opts.date);
  if (byId && byTitle) return { error: 'Use either --google-event, or --match-title with --date — not both.' };
  if (!byId && !(opts.matchTitle && opts.date)) {
    return { error: 'Say which meeting: --google-event <id>, or --match-title "<title>" --date YYYY-MM-DD.' };
  }
  if (opts.date && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) return { error: `Invalid --date "${opts.date}" (expected YYYY-MM-DD).` };
  const body: Record<string, string> = { deliverableId: opts.deliverable };
  if (opts.googleEvent) body['googleEventId'] = opts.googleEvent;
  if (opts.matchTitle) body['matchTitle'] = opts.matchTitle;
  if (opts.date) body['date'] = opts.date;
  if (opts.calendar) body['calendarId'] = opts.calendar;
  return { body };
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'link',
  description: 'Link a deliverable to a Google Calendar meeting — by event id, or by title on a day (link --deliverable <id> (--google-event <id> | --match-title "<title>" --date YYYY-MM-DD) [--calendar <id>])',
  setup(cmd) {
    cmd.option('--deliverable <id>', 'Deliverable UUID (required)');
    cmd.option('--google-event <id>', 'Google Calendar event id (an occurrence id for one meeting of a series)');
    cmd.option('--match-title <title>', 'Meeting title to look for on --date (case, accents, emojis and punctuation ignored; either title may contain the other)');
    cmd.option('--date <YYYY-MM-DD>', 'Day of the meeting, in the server\'s local time zone (with --match-title)');
    cmd.option('--calendar <id>', 'Google calendar id (default: primary)');
  },
  action: async (opts: LinkOptions) => {
    const built = buildLinkBody(opts);
    if ('error' in built) die(built.error);
    let res: { status: number; data: AgendaExternalLink };
    try {
      res = await agendaRequest<AgendaExternalLink>('POST', `${apiBase()}/api/agenda/google/link`, built.body);
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
