import { printJson, renderTable, trunc } from '../../../core/agentic.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { info } from '../../../core/colors.ts';
import { resolveRepoArg, type GitHubIssue } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface Options {
  repo?: string;
  json?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'issues',
  description: 'List open GitHub issues of a repository',
  setup(cmd) {
    cmd.argument('[org/name]', 'Repository reference (or use --repo)');
    cmd.option('--repo <org/name>', 'Repository reference');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (positional: string | undefined, opts: Options) => {
    const { org, name } = resolveRepoArg(positional, opts.repo);
    const issues = await apiGet<GitHubIssue[]>(
      `${apiBase()}/api/repositories/${org}/${name}/issues`,
    );
    if (opts.json) {
      printJson(issues);
      return;
    }
    if (issues.length === 0) {
      info('No issues found.');
      return;
    }
    issues.sort((a, b) => b.number - a.number);
    const rows = issues.map((i) => [`#${i.number}`, trunc(i.title, 60), i.author ?? '-']);
    renderTable(['ISSUE', 'TITLE', 'AUTHOR'], rows);
    info(`${issues.length} issue(s)`);
  },
};

export default def;
