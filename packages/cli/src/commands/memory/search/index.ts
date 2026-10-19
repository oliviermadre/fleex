import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { apiGet } from '../../../core/api.ts';
import { die, info, present } from '../../../core/colors.ts';
import { describeOrigin, memoryApi, oneLine, MEMORY_SOURCE_KINDS, type MemorySnippet } from '../_shared.ts';

/** How much a filtered search had to choose from, when it came back empty. */
export interface SearchScope {
  kinds: string[] | null;
  repo: string | null;
  searchableChunks?: number;
}

/**
 * Why a search returned nothing, in words.
 *
 * An empty list on its own cannot tell "nothing of this kind is indexed" from
 * "the filter is broken"; the scope the server sends back can.
 */
export function describeEmpty(query: string, scope: SearchScope | undefined): string {
  const searchable = scope?.searchableChunks;
  if (!scope || searchable === undefined) return `Nothing found for "${query}".`;
  const what = scope.kinds?.length ? scope.kinds.map((k) => `"${k}"`).join(', ') : null;
  if (searchable === 0) {
    if (what && scope.repo) return `No ${what} chunks attached to ${scope.repo} are indexed.`;
    if (what) return `No ${what} chunks are indexed yet — nothing to search in.`;
    return `No chunks attached to ${scope.repo} are indexed.`;
  }
  return `Nothing returned from ${searchable} ${what ? `${what} ` : ''}chunk(s) — this should not happen, please report it.`;
}

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
    // Filtered by the store, before ranking. Filtering the ranked list here only
    // ever saw the global top ten, so a sparse kind came back empty.
    if (opts.kind) params.set('kind', opts.kind);

    const res = await apiGet<{ query: string; results: MemorySnippet[]; scope?: SearchScope }>(
      memoryApi(`/search?${params.toString()}`),
    );
    const results = res.results;

    // The bare array stays the JSON shape, so existing callers keep working. Only
    // an empty filtered result carries its scope, which is what lets a caller —
    // the MCP tool included — tell an empty kind from a broken filter.
    const json = results.length === 0 && res.scope ? { results, scope: res.scope } : results;

    present(json, () => {
      if (results.length === 0) {
        info(describeEmpty(query, res.scope));
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
