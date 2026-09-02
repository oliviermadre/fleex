import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { apiGet } from '../../../core/api.ts';
import { die, info, present } from '../../../core/colors.ts';
import { memoryApi, oneLine } from '../_shared.ts';

interface Candidate {
  ticketId: string;
  title: string;
  score: number;
  excerpt: string;
}

interface SimilarOptions {
  limit?: string;
}

/**
 * The same check the ticket form runs while you type a title, on the command line.
 *
 * Useful before scripting a ticket creation: an agent or a script has no form to
 * warn it, so the duplicate it would file goes unnoticed until someone reads the
 * board.
 */
const def: CommandDef = {
  workspaceAware: true,
  name: 'similar',
  description: 'Find existing tickets that look like the same thing as a title',
  setup(cmd) {
    cmd.argument('<title...>', 'The ticket title to check');
    cmd.option('-n, --limit <n>', 'Maximum candidates to return (default 3, max 10)');
  },
  action: async (titleParts: string[], opts: SimilarOptions) => {
    const title = titleParts.join(' ').trim();
    if (!title) die('A ticket title is required.');

    const params = new URLSearchParams({ title });
    if (opts.limit) params.set('limit', opts.limit);

    const res = await apiGet<{ candidates: Candidate[] }>(
      memoryApi(`/similar-tickets?${params.toString()}`),
    );

    present(res.candidates, () => {
      if (res.candidates.length === 0) {
        info('No similar ticket found.');
        return;
      }
      for (const candidate of res.candidates) {
        const score = chalk.dim(`(${candidate.score.toFixed(2)})`);
        process.stdout.write(`${chalk.bold(candidate.title)} ${score}\n`);
        process.stdout.write(`  ${chalk.dim(candidate.ticketId)}\n`);
        process.stdout.write(`  ${oneLine(candidate.excerpt)}\n\n`);
      }
      info(`${res.candidates.length} possible duplicate(s)`);
    });
  },
};

export default def;
