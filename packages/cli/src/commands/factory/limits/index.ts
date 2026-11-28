import type { CommandDef } from '../../../core/types.ts';
import { c, ok, present } from '../../../core/colors.ts';
import { apiGet, apiPut } from '../../../core/api.ts';
import { fx, parseInteger } from '../_shared.ts';

interface LimitsOptions { runsPerHour?: string; concurrent?: string }
interface Overview { limits: { maxRunsPerHour: number; maxConcurrentRuns: number }; runsLastHour: number; running: number }

const def: CommandDef = {
  workspaceAware: true,
  name: 'limits',
  access: 'write',
  description: 'Show or set the floor\'s two run limits — runs started per hour, runs in flight at once (no flag: show them)',
  setup(cmd) {
    cmd.option('--runs-per-hour <n>', 'Station runs the floor may start per rolling hour (0 to 500; 0 starts nothing)');
    cmd.option('--concurrent <n>', 'Station runs the floor may have in flight at once (1 to 50)');
  },
  action: async (opts: LimitsOptions) => {
    const patch = {
      ...(opts.runsPerHour !== undefined ? { maxRunsPerHour: parseInteger(opts.runsPerHour, '--runs-per-hour') } : {}),
      ...(opts.concurrent !== undefined ? { maxConcurrentRuns: parseInteger(opts.concurrent, '--concurrent') } : {}),
    };
    const changed = Object.keys(patch).length > 0;
    if (changed) await apiPut(fx('/settings'), patch);
    const o = await apiGet<Overview>(fx('/overview'));
    present({ ...o.limits, runsLastHour: o.runsLastHour, running: o.running, changed }, () => {
      if (changed) ok('Limits saved.');
      process.stdout.write(`  ${c.dim('per hour  ')} ${o.runsLastHour}/${o.limits.maxRunsPerHour} runs started\n`);
      process.stdout.write(`  ${c.dim('at once   ')} ${o.running}/${o.limits.maxConcurrentRuns} runs in flight\n`);
    });
  },
};

export default def;
