import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { apiPost } from '../../../core/api.ts';
import { die, info, ok, present, warn } from '../../../core/colors.ts';
import { localTime, memoryApi } from '../_shared.ts';

interface ConsolidateOptions { since?: string; dryRun?: boolean }

/**
 * A catch-up judges history sequentially, ten exchanges per model call: 120 days
 * on a live instance was 37 calls and about ten minutes. The shared LLM timeout
 * (five minutes) dropped the answer while the server finished the pass.
 */
const CONSOLIDATE_TIMEOUT_MS = 30 * 60_000;

interface ConsolidationResult {
  status: 'done' | 'unavailable' | 'disabled' | 'busy';
  dryRun: boolean;
  window: { from: string; to: string } | null;
  stats: {
    resolvedMentions: number;
    candidates: number;
    judged: number;
    batches: number;
    failedBatches: number;
    corrections: number;
    skipped: number;
  };
  verdicts: Array<{
    mentionId: string;
    ticketDisplayId: number | string | null;
    agentName: string;
    verdict: 'lesson' | 'nothing' | 'unjudged';
    lesson?: string;
  }>;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'consolidate',
  description: 'Run the nightly pass now: learn from the times a human corrected an agent unprompted',
  setup(cmd) {
    cmd.option('--since <days>', 'Look back this many days instead of from the last pass (catch-up; leaves the nightly watermark alone)');
    cmd.option('--dry-run', 'Show candidates and verdicts without indexing anything');
  },
  action: async (opts: ConsolidateOptions) => {
    let sinceDays: number | undefined;
    if (opts.since !== undefined) {
      sinceDays = Number(opts.since);
      if (!Number.isFinite(sinceDays) || sinceDays <= 0) die('--since expects a positive number of days.');
    }

    const res = await apiPost<ConsolidationResult>(
      memoryApi('/consolidate'),
      { sinceDays, dryRun: !!opts.dryRun },
      CONSOLIDATE_TIMEOUT_MS,
    );

    present(res, () => {
      if (res.status === 'disabled') {
        warn('Consolidation is disabled (memory feature `consolidation`). Nothing was judged or indexed.');
        info('Turn it on with `fleex memory engine --enable consolidation`.');
        return;
      }

      const s = res.stats;
      if (res.window) {
        info(`Window ${localTime(res.window.from)} → ${localTime(res.window.to)}`);
      }
      info(`${s.resolvedMentions} resolved mention(s) · ${s.candidates} candidate(s) · ${s.skipped} skipped (already judged)`);
      info(`${s.judged} judged in ${s.batches} batch(es)${s.failedBatches ? ` · ${s.failedBatches} failed, retried next pass` : ''}`);

      for (const v of res.verdicts) {
        const ref = v.ticketDisplayId ? `#${v.ticketDisplayId}` : v.mentionId.slice(0, 8);
        const label = `${ref} ${v.agentName}`;
        if (v.verdict === 'lesson') process.stdout.write(`  ${chalk.green('✓')} ${label}: ${chalk.bold(`"${v.lesson}"`)}\n`);
        else if (v.verdict === 'nothing') process.stdout.write(`  ${chalk.dim(`· ${label}: NOTHING`)}\n`);
        else process.stdout.write(`  ${chalk.yellow('?')} ${label}: not judged\n`);
      }

      if (res.dryRun) warn(`DRY RUN · ${s.corrections} lesson(s) would be indexed · nothing written`);
      else ok(`${s.corrections} correction(s) indexed.`);
    });
  },
};

export default def;
