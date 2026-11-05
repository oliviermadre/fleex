import type { CommandDef } from '../../../core/types.ts';
import { die, info, present } from '../../../core/colors.ts';
import { apiBase } from '../../../core/api.ts';
import { agendaRequest, describeAgendaError, formatLink, type AgendaExternalLink } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'links',
  description: 'List deliverable ↔ Google meeting links, optionally for one deliverable (links [--deliverable <id>])',
  setup(cmd) {
    cmd.option('--deliverable <id>', 'Only the links of this deliverable (UUID)');
  },
  action: async (opts: { deliverable?: string }) => {
    const qs = opts.deliverable ? `?deliverableId=${encodeURIComponent(opts.deliverable)}` : '';
    let links: AgendaExternalLink[];
    try {
      links = (await agendaRequest<{ links: AgendaExternalLink[] }>('GET', `${apiBase()}/api/agenda/external-links${qs}`)).data.links;
    } catch (err) {
      die(describeAgendaError(err));
    }
    present({ ok: true, links }, () => {
      if (links.length === 0) {
        info('No links.');
        return;
      }
      for (const l of links) process.stdout.write(`${formatLink(l)}\n`);
    });
  },
};

export default def;
