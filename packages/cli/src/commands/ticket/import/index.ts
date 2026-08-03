import { apiBase, apiPost } from '../../../core/api.ts';
import { ok, die } from '../../../core/colors.ts';
import {
  assertValidStatus,
  assertValidType,
  parseGithubRef,
  parseGithubIssueUrl,
  resolveBoardId,
} from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface ImportOptions {
  board?: string;
  issue?: string;
  url?: string;
  status?: string;
  type?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'import',
  description:
    'Import a GitHub issue into a board as a new ticket (--issue org/name#n | --url <github issue url>)',
  extraHelp: `\nProvide exactly one of --issue or --url. The ticket is pre-filled with the\nissue title + body, linked to the issue and its repository, and its labels\nbecome tags. By default it lands in status backlog with no type; override\nwith --status / --type.\n\nExamples:\n  $ fleex ticket import --board <id> --issue oliviermadre/fleex#174\n  $ fleex ticket import --url https://github.com/oliviermadre/fleex/issues/174\n  $ fleex ticket import --issue oliviermadre/fleex#174 --status todo --type fix\n`,
  setup(cmd) {
    cmd.option('--board <id>', 'Board ID (auto-detected if only one)');
    cmd.option('--issue <org/name#n>', 'GitHub issue reference to import');
    cmd.option('--url <url>', 'Full GitHub issue URL to import');
    cmd.option('--status <status>', 'Initial status (default: backlog)');
    cmd.option('--type <type>', 'Type: build | fix | review | ops | lead | think');
  },
  action: async (opts: ImportOptions) => {
    if (!opts.issue && !opts.url) {
      die('Provide --issue org/name#n or --url <github issue url>');
    }
    if (opts.issue && opts.url) {
      die('--issue and --url are mutually exclusive');
    }
    if (opts.status) assertValidStatus(opts.status);
    if (opts.type) assertValidType(opts.type);

    const parsed = opts.issue
      ? parseGithubRef(opts.issue, 'issues')
      : parseGithubIssueUrl(opts.url!);

    const boardId = await resolveBoardId(opts.board);

    const body: Record<string, unknown> = {
      org: parsed.org,
      name: parsed.name,
      number: parsed.number,
      boardId,
    };
    if (opts.status) body.status = opts.status;
    if (opts.type) body.type = opts.type;

    const base = apiBase();
    const result = await apiPost<{ displayId: number; title: string; status: string }>(
      `${base}/api/tickets/import-github-issue`,
      body,
    );
    ok(`Created ticket #${result.displayId}: ${result.title} (${result.status})`);
    ok(`Linked issue ${parsed.ref}`);
  },
};

export default def;
