import type { CommandDef } from '../../../../core/types.ts';
import { die, ok, present } from '../../../../core/colors.ts';
import { apiBase } from '../../../../core/api.ts';
import { agendaRequest, describeAgendaError } from '../../_shared.ts';
import { fetchEvents } from '../../_read.ts';
import { resolveEventId } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'delete',
  aliases: ['rm'],
  description: 'Delete a free agenda event (the whole series for a repeating one).',
  setup(cmd) {
    cmd.argument('<event>', 'Event id, event:<id>, or the ag_… ref of one of its occurrences');
  },
  action: async (ref: string) => {
    const target = await resolveEventId(ref);
    if ('error' in target) die(target.error);
    let title = '';
    let id = target.id;
    try {
      const ev = (await fetchEvents()).find((e) => e.id === target.id || e.id.startsWith(target.id));
      if (!ev) die(`No free event ${target.id}.`);
      id = ev.id;
      title = ev.title;
      await agendaRequest('DELETE', `${apiBase()}/api/calendar-events/${encodeURIComponent(id)}`);
    } catch (err) {
      die(describeAgendaError(err));
    }
    present({ ok: true, deleted: true, id, title }, () => ok(`Deleted "${title}" (${id})`));
  },
};

export default def;
