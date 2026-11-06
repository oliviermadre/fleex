import type { AgendaGoogleStatus } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { c, die, present } from '../../../core/colors.ts';
import { apiBase } from '../../../core/api.ts';
import { agendaRequest, describeAgendaError } from '../_shared.ts';
import { calendarsToRead } from '../_read.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'status',
  description: 'Google Calendar connection: whether gogcli is installed and authorized, the account, the calendars it can read and the ones the agenda reads',
  setup(cmd) {
    cmd.option('--refresh', 'Ask gogcli again instead of the cached answer');
  },
  action: async (opts: { refresh?: boolean }) => {
    let s: AgendaGoogleStatus;
    let reading: string[];
    try {
      s = (await agendaRequest<AgendaGoogleStatus>('GET', `${apiBase()}/api/agenda/google/status${opts.refresh ? '?refresh=1' : ''}`)).data;
      reading = await calendarsToRead();
    } catch (err) {
      die(describeAgendaError(err));
    }
    present({ ok: true, ...s, reading: reading.length ? reading : ['primary'] }, () => {
      const out = (l: string) => process.stdout.write(`${l}\n`);
      out(`  ${c.bold('gogcli:')}    ${s.installed ? `installed${s.version ? ` (${s.version})` : ''}` : c.red('not installed')}`);
      out(`  ${c.bold('Connected:')} ${s.connected ? c.green(`yes${s.email ? ` — ${s.email}` : ''}`) : c.red('no')}`);
      if (s.error) out(`  ${c.bold('Error:')}     ${s.error}`);
      if (s.calendars.length) {
        out(`  ${c.bold('Calendars:')}`);
        for (const cal of s.calendars) {
          const read = reading.length ? reading.includes(cal.id) : cal.primary;
          out(`    ${read ? c.green('●') : c.dim('○')} ${cal.name}${cal.primary ? c.dim(' (primary)') : ''}  ${c.dim(cal.id)}`);
        }
      }
      if (!s.installed || !s.connected) out(`  Setup: ${s.setupUrl}`);
    });
  },
};

export default def;
