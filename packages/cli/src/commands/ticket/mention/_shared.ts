import type { MentionStatus } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { die, err, ok, present } from '../../../core/colors.ts';
import { apiBase, apiGet, apiPatch } from '../../../core/api.ts';
import { matchById } from '../../../core/match.ts';
import { resolveTicketId } from '../_shared.ts';

export interface Mention {
  id: string;
  targetAgent: string;
  targetType: string;
  status: string;
  executionMode?: string;
}

export function mentionLabel(m: Mention): string {
  return `@${m.targetType}:${m.targetAgent}`;
}

/** Resolve a mention on a ticket by full UUID or the 8-char id prefix shown by `ticket mentions`. */
export async function resolveMention(ticketUuid: string, input: string): Promise<Mention> {
  const mentions = await apiGet<Mention[]>(`${apiBase()}/api/tickets/${ticketUuid}/mentions`);
  const result = matchById(mentions, input);
  if (result.kind === 'found') return result.item;
  if (result.kind === 'ambiguous') {
    err(`"${input}" matches multiple mentions — use a longer id prefix:`);
    for (const m of result.matches) {
      process.stderr.write(`  ${m.id}  ${mentionLabel(m)} (${m.status})\n`);
    }
    process.exit(1);
  }
  die(`No mention on this ticket matches "${input}". List them with \`fleex ticket mentions <ticket>\`.`);
}

/** Resolve the ticket then the mention in one step (shared by every mention command). */
export async function getMention(ticketArg: string, mentionArg: string, board?: string): Promise<Mention> {
  const ticketUuid = await resolveTicketId(ticketArg, board);
  return resolveMention(ticketUuid, mentionArg);
}

/**
 * Build a leaf command that flips a mention to a fixed status via
 * PATCH /api/mentions/:id/status (resolve / ack / wait all share this route).
 */
export function makeStatusCommand(opts: {
  name: string;
  status: MentionStatus;
  description: string;
  pastTense: string;
}): CommandDef {
  return {
    workspaceAware: true,
    name: opts.name,
    description: opts.description,
    setup(cmd) {
      cmd.argument('<ticket>', 'Ticket display ID or UUID');
      cmd.argument('<mention>', 'Mention UUID or 8-char id prefix (see `fleex ticket mentions`)');
      cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
    },
    action: async (ticketArg: string, mentionArg: string, cmdOpts: { board?: string }) => {
      const mention = await getMention(ticketArg, mentionArg, cmdOpts.board);
      const updated = await apiPatch<Mention>(`${apiBase()}/api/mentions/${mention.id}/status`, { status: opts.status });
      present(updated, () => ok(`${opts.pastTense} mention ${mentionLabel(mention)} (${mention.id.slice(0, 8)})`));
    },
  };
}
