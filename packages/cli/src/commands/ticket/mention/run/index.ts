import { apiBase, apiPost } from '../../../../core/api.ts';
import { ok, present } from '../../../../core/colors.ts';
import { getMention, mentionLabel } from '../_shared.ts';

import type { CommandDef } from '../../../../core/types.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'run',
  description: 'Run (or re-run) a mention now (run <ticket> <mention>)',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket display ID or UUID');
    cmd.argument('<mention>', 'Mention UUID or 8-char id prefix (see `fleex ticket mentions`)');
    cmd.option('--board <id>', 'Disambiguate the ticket by board');
  },
  action: async (ticketArg: string, mentionArg: string, opts: { board?: string }) => {
    const mention = await getMention(ticketArg, mentionArg, opts.board);
    const result = await apiPost(`${apiBase()}/api/mentions/${mention.id}/run`, {});
    present(result ?? { ok: true }, () =>
      ok(`Triggered mention ${mentionLabel(mention)} (${mention.id.slice(0, 8)})`),
    );
  },
};

export default def;
