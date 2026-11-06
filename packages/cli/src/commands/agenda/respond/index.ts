import type { CommandDef } from '../../../core/types.ts';
import { die, ok, present } from '../../../core/colors.ts';
import { apiBase } from '../../../core/api.ts';
import { agendaRequest, describeAgendaError } from '../_shared.ts';
import { calendarsToRead, resolveItem, whenOf } from '../_read.ts';

const ANSWERS: Record<string, 'accepted' | 'tentative' | 'declined'> = {
  yes: 'accepted', accept: 'accepted', accepted: 'accepted',
  maybe: 'tentative', tentative: 'tentative',
  no: 'declined', decline: 'declined', declined: 'declined',
};

const def: CommandDef = {
  workspaceAware: true,
  name: 'respond',
  aliases: ['rsvp'],
  description: 'Answer a Google Calendar invitation: yes, maybe or no (the one write Fleex makes to Google)',
  setup(cmd) {
    cmd.argument('<item>', 'Agenda item ref of the meeting (ag_… from `agenda list` / `search`)');
    cmd.argument('<answer>', 'yes | maybe | no');
  },
  action: async (ref: string, answer: string) => {
    const status = ANSWERS[answer.trim().toLowerCase()];
    if (!status) die(`Invalid answer "${answer}" (expected yes, maybe or no).`);
    let title = '';
    try {
      const r = await resolveItem(ref, await calendarsToRead());
      if ('error' in r) die(r.error);
      const ext = r.item.external;
      if (r.item.type !== 'external' || !ext) die('Only a Google meeting can be answered.');
      if (!ext.canRespond || !ext.eventId) die('You are not a guest of this meeting (or you organize it): there is no invitation to answer.');
      title = `${r.item.title} (${whenOf(r.item)})`;
      await agendaRequest('POST', `${apiBase()}/api/agenda/google/respond`, { calendarId: ext.calendarId, eventId: ext.eventId, status });
    } catch (err) {
      die(describeAgendaError(err));
    }
    present({ ok: true, status, meeting: title }, () => ok(`Answered ${answer} — ${title}`));
  },
};

export default def;
