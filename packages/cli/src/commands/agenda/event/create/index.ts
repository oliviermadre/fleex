import type { CalendarEvent } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { die, ok, present } from '../../../../core/colors.ts';
import { apiBase } from '../../../../core/api.ts';
import { agendaRequest, describeAgendaError } from '../../_shared.ts';
import { addEventOptions, buildEventInput, eventLine, resolveRefs, type EventOptions } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'create',
  description:
    'Create a free agenda event: timed (--start + --end/--duration) or all-day (--all-day --date [--last-day]), with optional notes, colour, linked ticket or epic, and a daily/weekly/monthly repeat',
  setup(cmd) {
    addEventOptions(cmd, false);
  },
  action: async (opts: EventOptions) => {
    const built = buildEventInput(opts, null, await resolveRefs(opts));
    if ('error' in built) die(built.error);
    let event: CalendarEvent;
    try {
      event = (await agendaRequest<CalendarEvent>('POST', `${apiBase()}/api/calendar-events`, built.input)).data;
    } catch (err) {
      die(describeAgendaError(err));
    }
    present({ ok: true, event }, () => ok(`Created ${eventLine(event)}`));
  },
};

export default def;
