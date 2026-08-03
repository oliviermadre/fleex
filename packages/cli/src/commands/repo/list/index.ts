import { printJson, renderTable } from '../../../core/agentic.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { info } from '../../../core/colors.ts';

import type { CommandDef } from '../../../core/types.ts';
import type { Repository } from '../_shared.ts';

interface Summary {
  org: string;
  name: string;
  openIssuesCount: number;
  openPRsCount: number;
  recentlyMergedPRsCount: number;
  isClonedLocally: boolean;
}

interface ListOptions {
  json?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List configured repositories with their GitHub summary',
  setup(cmd) {
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (opts: ListOptions) => {
    const base = apiBase();
    const repos = await apiGet<Repository[]>(`${base}/api/repositories`);
    if (opts.json) {
      printJson(repos);
      return;
    }
    if (repos.length === 0) {
      info('No repositories configured. Add one with: fleex repo register <org/name>');
      return;
    }
    // Summaries are best-effort enrichment.
    const summaries = await apiGet<Summary[]>(`${base}/api/repositories/summaries`).catch(
      () => [] as Summary[],
    );
    const bySlug = new Map(summaries.map((s) => [`${s.org}/${s.name}`, s]));

    const rows = repos.map((r) => {
      const s = bySlug.get(`${r.org}/${r.name}`);
      return [
        `${r.org}/${r.name}`,
        r.defaultBranch ?? '-',
        r.isCloned ? 'yes' : 'no',
        String(s?.openPRsCount ?? '-'),
        String(s?.openIssuesCount ?? '-'),
      ];
    });
    renderTable(['REPO', 'DEFAULT', 'CLONED', 'OPEN PRS', 'OPEN ISSUES'], rows);
    info(`${repos.length} repository(ies)`);
  },
};

export default def;
