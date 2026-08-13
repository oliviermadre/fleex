import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { apiGet } from '../../../core/api.ts';
import { info, present } from '../../../core/colors.ts';
import { renderTable, trunc } from '../../../core/agentic.ts';
import { memoryApi } from '../_shared.ts';

interface SuggestOptions { min?: string; days?: string }

interface AutomationCandidate {
  key: string;
  kind: 'skill' | 'agent';
  target: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  meanGapHours: number;
  suggestedCron?: string;
  rationale: string;
  totalCostUsd: number;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'suggest',
  description: 'Find work you keep repeating by hand that a routine could do',
  setup(cmd) {
    cmd.option('--min <n>', 'Minimum occurrences to count as a habit (default 4)');
    cmd.option('--days <n>', 'How far back to look (default 60)');
  },
  action: async (opts: SuggestOptions) => {
    const params = new URLSearchParams();
    if (opts.min) params.set('minOccurrences', opts.min);
    if (opts.days) params.set('windowDays', opts.days);

    const query = params.toString();
    const res = await apiGet<{ candidates: AutomationCandidate[] }>(
      memoryApi(`/automation-candidates${query ? `?${query}` : ''}`),
    );

    present(res.candidates, () => {
      if (res.candidates.length === 0) {
        info('Nothing repeated often enough yet — or routine suggestions are switched off in Settings › Memory.');
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
        process.stdout.write(`\n${chalk.bold(candidate.target)} — ${candidate.rationale}\n`);
        if (candidate.suggestedCron) {
          process.stdout.write(chalk.dim(
            `  fleex routine create "${candidate.target}" --${candidate.kind} ${candidate.target} --cron "${candidate.suggestedCron}"\n`,
          ));
        }
      }
      process.stdout.write(`\n${res.candidates.length} candidate(s)\n`);
    });
  },
};

export default def;
