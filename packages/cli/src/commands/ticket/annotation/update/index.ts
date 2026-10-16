import type { TimelineAnnotation } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { ok, die, present } from '../../../../core/colors.ts';
import { apiBase, apiPatch } from '../../../../core/api.ts';
import { resolveTicketId } from '../../_shared.ts';
import { assertValidTone, resolveBody } from '../_shared.ts';

interface UpdateOptions {
  board?: string;
  title?: string;
  body?: string;
  bodyFile?: string;
  at?: string;
  tone?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'update',
  aliases: ['edit'],
  description: 'Update an annotation (partial — only provided fields change)',
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('<annotation-id>', 'Annotation UUID');
    cmd.option('--title <title>', 'New title (1..80 chars)');
    cmd.option('--body <markdown>', 'New detail (markdown)');
    cmd.option('--body-file <path>', 'Read the new detail from a file');
    cmd.option('--at <instant>', 'Move it: ISO instant or "now"');
    cmd.option('--tone <tone>', 'info | highlight | warning | success');
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
  },
  action: async (ticketIdArg: string, annotationId: string, opts: UpdateOptions) => {
    const patch: Record<string, string> = {};
    if (opts.title !== undefined) patch.title = opts.title;
    if (opts.at !== undefined) patch.at = opts.at;
    if (opts.tone !== undefined) {
      assertValidTone(opts.tone);
      patch.tone = opts.tone;
    }
    const body = resolveBody(opts);
    if (body !== undefined) patch.body = body;
    if (Object.keys(patch).length === 0) {
      die('Nothing to update: pass at least one of --title, --body, --body-file, --at, --tone.');
    }
    const uuid = await resolveTicketId(ticketIdArg, opts.board);
    const updated = await apiPatch<TimelineAnnotation>(`${apiBase()}/api/tickets/${uuid}/annotations/${annotationId}`, patch);
    present(updated, () => ok(`Annotation updated: ${updated.id}`));
  },
};

export default def;
