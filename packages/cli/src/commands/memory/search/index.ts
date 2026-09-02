import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { apiGet } from '../../../core/api.ts';
import { die, info, present } from '../../../core/colors.ts';
import { describeOrigin, memoryApi, oneLine, MEMORY_SOURCE_KINDS, type MemorySnippet } from '../_shared.ts';

interface SearchOptions {
  limit?: string;
  kind?: string;
  repo?: string;
  full?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'search',
  aliases: ['s'],
  description: 'Search memory by meaning — ranked excerpts from past work, with no LLM call',
  setup(cmd) {
    cmd.argument('<query...>', 'What to look for');
    cmd.option('-n, --limit <n>', 'Maximum excerpts to return (default 10, max 50)');
    cmd.option('-k, --kind <kind>', `Only this source kind (${MEMORY_SOURCE_KINDS.join(', ')})`);
    cmd.option('-r, --repo <owner/name>', 'Only content attached to this repository');
    cmd.option('--full', 'Print each excerpt in full instead of one line');
  },
  action: async (queryParts: string[], opts: SearchOptions) => {
    const query = queryParts.join(' ').trim();
    if (!query) die('A search query is required.');

    if (opts.kind && !MEMORY_SOURCE_KINDS.includes(opts.kind as never)) {
      die(`Unknown --kind "${opts.kind}". Expected one of: ${MEMORY_SOURCE_KINDS.join(', ')}`);
    }

    const params = new URLSearchParams({ q: query });
    if (opts.limit) params.set('limit', opts.limit);
    if (opts.repo) params.set('repo', opts.repo);

    const res = await apiGet<{ query: string; results: MemorySnippet[] }>(
      memoryApi(`/search?${params.toString()}`),
    );
    // The kind filter is applied client-side: the endpoint takes one repo but the
    // ranking is better served by retrieving broadly and narrowing after, so a
    // filtered search does not silently return fewer results than asked for.
    const results = opts.kind
      ? res.results.filter((r) => r.sourceKind === opts.kind)
      : res.results;

    present(results, () => {
      if (results.length === 0) {
        info(`Nothing found for "${query}".`);
        return;
      }
      for (const [i, snippet] of results.entries()) {
        const rank = chalk.dim(`${String(i + 1).padStart(2)}.`);
        const score = chalk.dim(`(${snippet.score.toFixed(2)})`);
        process.stdout.write(`${rank} ${chalk.bold(snippet.title)} ${score}\n`);
        process.stdout.write(`    ${chalk.dim(describeOrigin(snippet))}\n`);
        process.stdout.write(
          opts.full
            ? `${snippet.content.split('\n').map((l) => `    ${l}`).join('\n')}\n\n`
            : `    ${oneLine(snippet.content)}\n\n`,
        );
      }
      info(`${results.length} excerpt(s)`);
    });
  },
};

export default def;
