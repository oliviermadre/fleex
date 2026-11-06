import { agendaItemLinkKey } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { die, info, present } from '../../../core/colors.ts';
import { apiBase } from '../../../core/api.ts';
import { agendaRequest, describeAgendaError, formatLink, type AgendaExternalLink } from '../_shared.ts';
import { calendarsToRead, resolveItem } from '../_read.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'links',
  description:
    'List deliverable ↔ meeting links: those of one meeting or event (--item), those of one deliverable (--deliverable), or all of them',
  setup(cmd) {
    cmd.option('--deliverable <id>', 'Only the links of this deliverable (UUID)');
    cmd.option('--item <ref>', 'Only the links of this meeting or event (ag_… ref, or event:<id>)');
  },
  action: async (opts: { deliverable?: string; item?: string }) => {
    const qs = new URLSearchParams();
    let links: AgendaExternalLink[];
    try {
      if (opts.deliverable) qs.set('deliverableId', opts.deliverable);
      if (opts.item) {
        const r = await resolveItem(opts.item, await calendarsToRead());
        if ('error' in r) die(r.error);
        const key = agendaItemLinkKey(r.item);
        if (!key) die(`A ${r.item.type} item has no deliverable links (only Google meetings and free events do).`);
        qs.set('eventKey', key);
      }
      const q = qs.toString();
      links = (await agendaRequest<{ links: AgendaExternalLink[] }>('GET', `${apiBase()}/api/agenda/external-links${q ? `?${q}` : ''}`)).data.links;
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
