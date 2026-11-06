import type { CalendarEvent } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { die, ok, present } from '../../../../core/colors.ts';
import { apiBase } from '../../../../core/api.ts';
import { agendaRequest, describeAgendaError } from '../../_shared.ts';
import { fetchEvents } from '../../_read.ts';
import { addEventOptions, buildEventInput, eventLine, resolveEventId, resolveRefs, type EventOptions } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'update',
  aliases: ['edit', 'move'],
  description:
    'Edit, move or resize a free agenda event (the whole series for a repeating one). A new --start without --end (or --date without --last-day) keeps the length, like dragging in the agenda.',
  setup(cmd) {
    cmd.argument('<event>', 'Event id, event:<id>, or the ag_… ref of one of its occurrences');
    addEventOptions(cmd, true);
  },
  action: async (ref: string, opts: EventOptions) => {
    const target = await resolveEventId(ref);
    if ('error' in target) die(target.error);
    let event: CalendarEvent;
    try {
      const base = (await fetchEvents()).find((e) => e.id === target.id || e.id.startsWith(target.id));
      if (!base) die(`No free event ${target.id}.`);
      const built = buildEventInput(opts, base, await resolveRefs(opts));
      if ('error' in built) die(built.error);
      if (Object.keys(built.input).length === 0) die('Nothing to change — pass at least one option (see --help).');
      event = (await agendaRequest<CalendarEvent>('PATCH', `${apiBase()}/api/calendar-events/${encodeURIComponent(base.id)}`, built.input)).data;
    } catch (err) {
      die(describeAgendaError(err));
    }
    present({ ok: true, event }, () => ok(`Updated ${eventLine(event)}`));
  },
};

export default def;
