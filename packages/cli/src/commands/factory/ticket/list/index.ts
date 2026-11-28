import type { CommandDef } from '../../../../core/types.ts';
import { info, present } from '../../../../core/colors.ts';
import { renderTable } from '../../../../core/agentic.ts';
import { TOKEN_HEADERS, fetchTokens, resolveMachine, tokenRows } from '../../_shared.ts';

interface ListOptions { machine?: string; needs?: boolean; items?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  access: 'read',
  aliases: ['ls'],
  description: 'List the tickets on the floor — where each stands, for how long, what it waits for',
  setup(cmd) {
    cmd.option('--machine <machine>', 'Only what stands on this machine (name, id or id prefix)');
    cmd.option('--needs', 'Only those that wait for someone');
    cmd.option('--items', 'Also list the items (conversations from Slack, Gmail, GitHub), which travel with the tickets');
  },
  action: async (opts: ListOptions) => {
    const machineId = opts.machine !== undefined ? (await resolveMachine(opts.machine)).id : null;
    const tokens = (await fetchTokens()).filter((t) => (opts.items || t.kind === 'ticket') && (!machineId || t.machineId === machineId) && (!opts.needs || t.need));
    present(tokens, () => {
      if (tokens.length === 0) { info(opts.needs ? 'Nothing here waits for anyone.' : 'No ticket on the floor. `fleex factory ticket send <ticket>` hands one over.'); return; }
      renderTable(TOKEN_HEADERS, tokenRows(tokens));
      info(`${tokens.length} on the floor`);
    });
  },
};

export default def;
