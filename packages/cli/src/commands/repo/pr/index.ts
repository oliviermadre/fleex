import type { CommandDef } from '../../../core/types.ts';
import { die, info } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { printJson, renderTable, trunc } from '../../../core/agentic.ts';
import { resolveRepoArg, type PullRequest } from '../_shared.ts';

const STATES = ['open', 'merged', 'closed'] as const;

interface Options { repo?: string; state?: string; json?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'pr',
  aliases: ['prs', 'pulls'],
  description: 'List the pull requests of a repository',
  setup(cmd) {
    cmd.argument('[org/name]', 'Repository reference (or use --repo)');
    cmd.option('--repo <org/name>', 'Repository reference');
    cmd.option('--state <state>', 'Filter by state: open | merged | closed');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (positional: string | undefined, opts: Options) => {
    if (opts.state && !STATES.includes(opts.state as typeof STATES[number])) {
      die(`Invalid --state "${opts.state}" (valid: ${STATES.join(', ')})`);
    }
    const { org, name } = resolveRepoArg(positional, opts.repo);
    let prs = await apiGet<PullRequest[]>(`${apiBase()}/api/repositories/${org}/${name}/pulls`);
    if (opts.state) prs = prs.filter((p) => p.state === opts.state);
    if (opts.json) {
      printJson(prs);
      return;
    }
    if (prs.length === 0) {
      info('No pull requests found.');
      return;
    }
    prs.sort((a, b) => b.number - a.number);
    const rows = prs.map((p) => [
      `#${p.number}`,
      p.state + (p.isDraft ? ' (draft)' : ''),
      trunc(p.title, 50),
      trunc(p.headRefName, 28),
      p.author ?? '-',
    ]);
    renderTable(['PR', 'STATE', 'TITLE', 'BRANCH', 'AUTHOR'], rows);
    info(`${prs.length} pull request(s)`);
  },
};

export default def;
