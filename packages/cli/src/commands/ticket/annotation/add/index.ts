import type { TimelineAnnotation } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { ok, present } from '../../../../core/colors.ts';
import { apiBase, apiPost } from '../../../../core/api.ts';
import { resolveTicketId } from '../../_shared.ts';
import { assertValidTone, resolveBody } from '../_shared.ts';

interface AddOptions {
  board?: string;
  title: string;
  body?: string;
  bodyFile?: string;
  at?: string;
  tone?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'add',
  aliases: ['create', 'new'],
  description: 'Pin an annotation to an instant of the ticket Timeline',
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.requiredOption('--title <title>', 'Short title, always shown on the card (1..80 chars)');
    cmd.option('--body <markdown>', 'Optional detail (markdown, ≤ 4000 chars)');
    cmd.option('--body-file <path>', 'Read the detail from a file');
    cmd.option('--at <instant>', 'ISO instant or "now"', 'now');
    cmd.option('--tone <tone>', 'info | highlight | warning | success', 'info');
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
  },
  action: async (ticketIdArg: string, opts: AddOptions) => {
    const tone = opts.tone ?? 'info';
    assertValidTone(tone);
    const body = resolveBody(opts);
    const uuid = await resolveTicketId(ticketIdArg, opts.board);
    const created = await apiPost<TimelineAnnotation>(`${apiBase()}/api/tickets/${uuid}/annotations`, {
      at: opts.at ?? 'now',
      title: opts.title,
      tone,
      ...(body !== undefined ? { body } : {}),
    });
    present(created, () => ok(`Annotation added: ${created.id} (${created.at})`));
  },
};

export default def;
