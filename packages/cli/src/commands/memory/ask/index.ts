import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { apiPost } from '../../../core/api.ts';
import { die, info, present, warn } from '../../../core/colors.ts';
import { describeOrigin, memoryApi, type MemorySnippet } from '../_shared.ts';

interface AskOptions {
  limit?: string;
  repo?: string;
  sources?: boolean;
}

interface AskResponse {
  answer: string | null;
  sources: MemorySnippet[];
  reason?: 'no_results' | 'synthesis_failed' | 'unavailable';
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'ask',
  aliases: ['a'],
  description: 'Ask a question of this workspace\'s memory and get a cited answer (one LLM call)',
  setup(cmd) {
    cmd.argument('<question...>', 'The question to answer from past work');
    cmd.option('-n, --limit <n>', 'Excerpts to consider (default 12)');
    cmd.option('-r, --repo <owner/name>', 'Only draw on content attached to this repository');
    cmd.option('--sources', 'List the excerpts the answer cites');
  },
  action: async (questionParts: string[], opts: AskOptions) => {
    const question = questionParts.join(' ').trim();
    if (!question) die('A question is required.');

    const res = await apiPost<AskResponse>(memoryApi('/ask'), {
      question,
      limit: opts.limit ? Number.parseInt(opts.limit, 10) : undefined,
      repo: opts.repo ?? null,
    });

    present(res, () => {
      if (!res.answer) {
        // "The memory does not know" is a real answer, and distinguishing it from
        // a failure is the difference between trusting the tool and second-guessing it.
        if (res.reason === 'no_results') {
          info(`Nothing in memory relates to "${question}".`);
        } else if (res.reason === 'synthesis_failed') {
          warn(`Retrieved ${res.sources.length} excerpt(s) but could not synthesise an answer. Try \`fleex memory search\`.`);
        } else {
          warn('Memory is unavailable. Enable the semantic engine in Settings › Memory.');
        }
        return;
      }

      process.stdout.write(`${res.answer}\n`);

      if (opts.sources && res.sources.length > 0) {
        process.stdout.write(`\n${chalk.bold('Sources')}\n`);
        for (const [i, snippet] of res.sources.entries()) {
          process.stdout.write(`  [${i + 1}] ${snippet.title}\n`);
          process.stdout.write(`      ${chalk.dim(describeOrigin(snippet))}\n`);
        }
      } else if (res.sources.length > 0) {
        info(`${res.sources.length} excerpt(s) considered — rerun with --sources to list them.`);
      }
    });
  },
};

export default def;
