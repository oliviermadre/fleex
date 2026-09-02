import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { apiGet, BENCH_TIMEOUT_MS } from '../../../core/api.ts';
import { info, present, warn } from '../../../core/colors.ts';
import { memoryApi } from '../_shared.ts';

interface BenchOptions { cases?: string; k?: string; misses?: boolean }

interface BenchResult {
  model: string;
  dimensions: number;
  report: {
    cases: number;
    recallAtK: number;
    k: number;
    mrr: number;
    misses: Array<{ query: string; expected: string[]; returned: string[] }>;
  };
  meanQueryMs: number;
  indexedChunks: number;
  reason?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'bench',
  description: 'Measure how well retrieval finds things on this corpus (recall@K, MRR, latency)',
  setup(cmd) {
    cmd.option('-n, --cases <n>', 'Queries to run (default 30)');
    cmd.option('-k, --k <n>', 'Results per query, and the K in recall@K (default 5)');
    cmd.option('--misses', 'List the queries that found nothing expected');
  },
  action: async (opts: BenchOptions) => {
    const params = new URLSearchParams();
    if (opts.cases) params.set('cases', opts.cases);
    if (opts.k) params.set('k', opts.k);

    const query = params.toString();
    const res = await apiGet<BenchResult>(memoryApi(`/bench${query ? `?${query}` : ''}`), BENCH_TIMEOUT_MS);

    present(res, () => {
      if (res.reason === 'unavailable') {
        warn('No memory index on this storage driver, or no embedding provider configured.');
        return;
      }
      if (res.reason === 'empty_index') {
        info('Index is empty. Run `fleex memory reindex` first.');
        return;
      }
      if (res.reason === 'no_cases') {
        info('Not enough substantial content indexed yet to derive test queries.');
        return;
      }

      const { report } = res;
      process.stdout.write(`${chalk.bold('Model')}      ${res.model} (${res.dimensions} dims)\n`);
      process.stdout.write(`${chalk.bold('Index')}      ${res.indexedChunks} chunks\n`);
      process.stdout.write(`${chalk.bold('Cases')}      ${report.cases}\n`);
      process.stdout.write(`${chalk.bold(`Recall@${report.k}`)}  ${(report.recallAtK * 100).toFixed(1)}%\n`);
      process.stdout.write(`${chalk.bold('MRR')}        ${report.mrr.toFixed(3)}\n`);
      process.stdout.write(`${chalk.bold('Latency')}    ${res.meanQueryMs}ms per query\n`);

      if (opts.misses && report.misses.length > 0) {
        process.stdout.write(`\n${chalk.bold('Found nothing expected')}\n`);
        for (const miss of report.misses) {
          process.stdout.write(`  - ${miss.query}\n`);
        }
      }

      // The numbers only mean something compared to another run, so say what the
      // comparison is rather than leaving a bare percentage to be over-read.
      info('Change the embedding model, reindex, and re-run to compare. MRR is the one that predicts whether a prompt will actually contain the answer.');
    });
  },
};

export default def;
