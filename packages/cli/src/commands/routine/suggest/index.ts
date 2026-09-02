import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { info, present } from '../../../core/colors.ts';
import { renderTable, trunc } from '../../../core/agentic.ts';

interface SuggestOptions { min?: string; days?: string; all?: boolean }

interface AutomationCandidate {
  key: string;
  kind: 'skill' | 'agent';
  targetId: string;
  /** What `routine create` takes: a persona name, or a skill command name. */
  target: string;
  label: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  meanGapHours: number;
  suggestedCron?: string;
  rationale: string;
  totalCostUsd: number;
}

/** "The Builder (builder)" when the display name adds something, else just the ref. */
function heading(candidate: AutomationCandidate): string {
  const name = chalk.bold(candidate.label);
  return candidate.label === candidate.target ? name : `${name} ${chalk.dim(`(${candidate.target})`)}`;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'suggest',
  description: 'Find work you repeat by hand on a cadence a routine could fire on',
  setup(cmd) {
    cmd.option('--min <n>', 'Minimum occurrences to count as a habit (default 4)');
    cmd.option('--days <n>', 'How far back to look (default 60)');
    cmd.option('--all', 'Also show repeated work too irregular to schedule (diagnostic)');
  },
  action: async (opts: SuggestOptions) => {
    const params = new URLSearchParams();
    if (opts.min) params.set('minOccurrences', opts.min);
    if (opts.days) params.set('windowDays', opts.days);
    if (opts.all) params.set('includeIrregular', 'true');

    const query = params.toString();
    const res = await apiGet<{ candidates: AutomationCandidate[] }>(
      `${apiBase()}/api/routines/suggestions${query ? `?${query}` : ''}`,
    );

    present(res.candidates, () => {
      if (res.candidates.length === 0) {
        // Distinguished on purpose: "nothing is regular enough" is the expected
        // answer most of the time, and reads very differently from "the feature
        // is off". Pointing at `--all` is what makes the first one checkable.
        info(opts.all
          ? 'Nothing repeated often enough yet — or routine suggestions are switched off in Settings › Memory.'
          : 'Nothing you repeat on a regular enough cadence to schedule. Add --all to see repeated work that is too irregular for a cron.');
        return;
      }

      const rows = res.candidates.map((c) => [
        c.kind,
        trunc(c.target, 28),
        String(c.occurrences),
        `${c.meanGapHours}h`,
        c.suggestedCron ?? '-',
        c.totalCostUsd > 0 ? `$${c.totalCostUsd.toFixed(2)}` : '-',
      ]);
      renderTable(['KIND', 'TARGET', 'RUNS', 'MEAN GAP', 'CRON', 'SPENT'], rows);

      // The rationale is the part that justifies acting, so it is printed in full
      // rather than truncated into the table.
      for (const candidate of res.candidates) {
        process.stdout.write(`\n${heading(candidate)} — ${candidate.rationale}\n`);
        if (candidate.suggestedCron) {
          process.stdout.write(chalk.dim(
            `  fleex routine create "${candidate.label}" --${candidate.kind} "${candidate.target}" --cron "${candidate.suggestedCron}"\n`,
          ));
        }
      }
      process.stdout.write(`\n${res.candidates.length} candidate(s)\n`);
    });
  },
};

export default def;
