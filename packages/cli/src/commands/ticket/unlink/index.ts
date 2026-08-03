import type { CommandDef } from '../../../core/types.ts';
import { ok, die, info } from '../../../core/colors.ts';
import { apiBase, apiGet, apiDelete } from '../../../core/api.ts';
import { accumulate, resolvePrRef, resolveIssueRef, resolveTicketId } from '../_shared.ts';

interface UnlinkOptions {
  repo?: string[];
  pr?: string[];
  issue?: string[];
  board?: string;
}

interface TicketWithLinks {
  links: Array<{ id: string; type: string; ref: string }>;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'unlink',
  description: 'Unlink repositories / PRs / issues from a ticket — --pr and --issue accept a full GitHub URL or org/name#N (unlink <id> --repo org/name | --pr <pr-url|org/name#n> | --issue <issue-url|org/name#n>)',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID or UUID');
    cmd.option('--repo <org/name>', 'Repository to unlink (repeatable)', accumulate, [] as string[]);
    cmd.option('--pr <url|org/name#n>', 'GitHub PR to unlink — full PR URL or org/name#N (repeatable)', accumulate, [] as string[]);
    cmd.option('--issue <url|org/name#n>', 'GitHub issue to unlink — full issue URL or org/name#N (repeatable)', accumulate, [] as string[]);
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
  },
  action: async (idArg: string, opts: UnlinkOptions) => {
    const repos = opts.repo ?? [];
    const prs = opts.pr ?? [];
    const issues = opts.issue ?? [];
    if (repos.length === 0 && prs.length === 0 && issues.length === 0) {
      die('Nothing to unlink. Use --repo org/name, --pr org/name#n, or --issue org/name#n.');
    }

    for (const r of repos) {
      const slashIdx = r.indexOf('/');
      if (slashIdx <= 0 || slashIdx !== r.lastIndexOf('/') || slashIdx === r.length - 1) {
        die(`Invalid --repo "${r}" (expected format org/name, e.g. github/fleex)`);
      }
    }
    // Accepts a full GitHub URL or org/name#N; both normalise to the canonical
    // org/name#N ref, so unlink matches a link made either way.
    const prRefs = prs.map(resolvePrRef);
    const issueRefs = issues.map(resolveIssueRef);

    const uuid = await resolveTicketId(idArg, opts.board);
    const base = apiBase();
    const ticket = await apiGet<TicketWithLinks>(`${base}/api/tickets/${uuid}`);

    // Each entry: the link type, the ref to match, and a human label for messages.
    const targets: Array<{ type: string; ref: string; kind: string }> = [
      ...repos.map((r) => ({ type: 'repository', ref: r, kind: 'repo' })),
      ...prRefs.map((p) => ({ type: 'github_pr', ref: p.ref, kind: 'PR' })),
      ...issueRefs.map((i) => ({ type: 'github_issue', ref: i.ref, kind: 'issue' })),
    ];

    for (const t of targets) {
      const link = ticket.links.find((l) => l.type === t.type && l.ref === t.ref);
      if (!link) {
        info(`${t.kind} ${t.ref} is not linked to this ticket — skipping`);
        continue;
      }
      await apiDelete(`${base}/api/tickets/${uuid}/links/${link.id}`);
      ok(`Unlinked ${t.kind} ${t.ref} from ticket`);
    }
  },
};

export default def;
