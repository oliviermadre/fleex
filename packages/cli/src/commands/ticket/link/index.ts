import type { CommandDef } from '../../../core/types.ts';
import { ok, die, err, info, c, present } from '../../../core/colors.ts';
import { apiBase, apiGet, apiPost } from '../../../core/api.ts';
import { accumulate, resolvePrRef, resolveIssueRef, resolveTicketId } from '../_shared.ts';

interface LinkOptions {
  repo?: string[];
  pr?: string[];
  issue?: string[];
  board?: string;
}

interface Repository {
  org: string;
  name: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'link',
  description: 'Link repositories / PRs / issues to a ticket — --pr and --issue accept a full GitHub URL or org/name#N (link <id> --repo org/name | --pr <pr-url|org/name#n> | --issue <issue-url|org/name#n>)',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID or UUID');
    cmd.option('--repo <org/name>', 'Repository to link (repeatable)', accumulate, [] as string[]);
    cmd.option('--pr <url|org/name#n>', 'GitHub PR to link — full PR URL or org/name#N (repeatable)', accumulate, [] as string[]);
    cmd.option('--issue <url|org/name#n>', 'GitHub issue to link — full issue URL or org/name#N (repeatable)', accumulate, [] as string[]);
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
  },
  action: async (idArg: string, opts: LinkOptions) => {
    const repos = opts.repo ?? [];
    const prs = opts.pr ?? [];
    const issues = opts.issue ?? [];
    if (repos.length === 0 && prs.length === 0 && issues.length === 0) {
      die('Nothing to link. Use --repo org/name, --pr org/name#n, or --issue org/name#n.');
    }

    // Validate repo format (org/name, exactly one slash, non-empty parts).
    for (const r of repos) {
      const slashIdx = r.indexOf('/');
      if (slashIdx <= 0 || slashIdx !== r.lastIndexOf('/') || slashIdx === r.length - 1) {
        die(`Invalid --repo "${r}" (expected format org/name, e.g. github/fleex)`);
      }
    }
    // Validate PR/issue refs up-front — accepts a full GitHub URL or org/name#N.
    const prRefs = prs.map(resolvePrRef);
    const issueRefs = issues.map(resolveIssueRef);

    const uuid = await resolveTicketId(idArg, opts.board);
    const base = apiBase();

    // Validate each repo is known (consistent with the web picker).
    if (repos.length > 0) {
      const known = await apiGet<Repository[]>(`${base}/api/repositories`);
      const knownSet = new Set(known.map((rp) => `${rp.org}/${rp.name}`));
      const unknown = repos.filter((r) => !knownSet.has(r));
      if (unknown.length > 0) {
        err(`Unknown repository: ${unknown.join(', ')}`);
        process.stderr.write(`${c.blue('[fleex]')} Available repositories:\n`);
        for (const rp of known) {
          process.stderr.write(`  - ${rp.org}/${rp.name}\n`);
        }
        if (known.length === 0) process.stderr.write('  (none — add a repository in the web UI first)\n');
        process.exit(1);
      }
    }

    // Each entry: the link type, the ref, and the request body to send.
    const targets: Array<{ type: string; ref: string; body: Record<string, unknown> }> = [
      ...repos.map((r) => ({ type: 'repository', ref: r, body: { type: 'repository', ref: r, label: r } })),
      ...prRefs.map((p) => ({ type: 'github_pr', ref: p.ref, body: { type: 'github_pr', ref: p.ref, label: p.ref, url: p.url } })),
      ...issueRefs.map((i) => ({ type: 'github_issue', ref: i.ref, body: { type: 'github_issue', ref: i.ref, label: i.ref, url: i.url } })),
    ];

    // Collect first, report once: under --json a caller needs one payload, not a
    // stream of human sentences — and it must be able to tell what was actually
    // linked from what was already there. `created === undefined` means an older
    // server that does not report it; we then fall back to the optimistic
    // message rather than wrongly claiming a no-op.
    const linked: Array<{ type: string; ref: string }> = [];
    const skipped: Array<{ type: string; ref: string }> = [];
    for (const t of targets) {
      const link = await apiPost<{ created?: boolean }>(`${base}/api/tickets/${uuid}/links`, t.body);
      const entry = { type: t.type, ref: t.ref };
      if (link?.created === false) skipped.push(entry);
      else linked.push(entry);
    }

    present({ ok: true, ticketId: uuid, linked, skipped }, () => {
      for (const s of skipped) info(`${s.type} ${s.ref} is already linked to this ticket — skipping`);
      for (const l of linked) ok(`Linked ${l.type} ${l.ref} to ticket`);
    });
  },
};

export default def;
