import type { CommandDef } from '../../../../core/types.ts';
import { ok, present } from '../../../../core/colors.ts';
import { apiPost } from '../../../../core/api.ts';
import { resolveTicketId } from '../../../ticket/_shared.ts';
import { enc, fetchToken, fx, printToken, refOf, resolveTarget } from '../../_shared.ts';

interface SendOptions { to?: string; x?: string; y?: string; board?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'send',
  access: 'write',
  aliases: ['transfer'],
  description: 'Hand a ticket over to the Factory — it lands in the Inbound zone, or on the machine or tile you name; from then on the floor routes it',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket number (42, #42) or UUID — any ticket of Fleex that is not on the floor yet');
    cmd.option('--to <machine>', 'Put it on this machine (name, id or id prefix) instead of Inbound');
    cmd.option('--x <n>', 'Or lay it on the floor at this tile (with --y)');
    cmd.option('--y <n>', 'Tile row, with --x');
    cmd.option('--board <board>', 'Disambiguate the ticket number by board (name, UUID, or 8-char id prefix)');
  },
  action: async (ref: string, opts: SendOptions) => {
    const ticketId = await resolveTicketId(ref, opts.board);
    const target = await resolveTarget(opts);
    await apiPost(fx(`/tickets/${enc(ticketId)}/transfer`), target ?? {});
    const after = await fetchToken(ticketId);
    present(after, () => { ok(`Handed over to the Factory: ${refOf(after)}`); printToken(after); });
  },
};

export default def;
