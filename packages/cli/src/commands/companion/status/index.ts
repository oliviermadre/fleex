import type { CommandDef } from '../../../core/types.ts';
import { c } from '../../../core/colors.ts';
import {
  COMPANION_PORT,
  companionLogFile,
  companionRepoDir,
  isCompanionHealthy,
  readCompanionPid,
} from '../../../core/companion.ts';

const def: CommandDef = {
  name: 'status',
  description: 'Show whether the side-panel companion is running',
  action: async () => {
    const healthy = await isCompanionHealthy();
    const pid = readCompanionPid();
    const state = healthy ? c.green('running') : c.dim('stopped');
    process.stdout.write('\n');
    process.stdout.write(`  ${c.bold('fleex companion')}\n\n`);
    process.stdout.write(`  ${'Status'.padEnd(8)} ${state}\n`);
    process.stdout.write(`  ${'URL'.padEnd(8)} http://localhost:${COMPANION_PORT}\n`);
    process.stdout.write(`  ${'PID'.padEnd(8)} ${pid ?? '-'}\n`);
    process.stdout.write(`  ${'Source'.padEnd(8)} ${c.dim(companionRepoDir())}\n`);
    process.stdout.write(`  ${'Log'.padEnd(8)} ${c.dim(companionLogFile())}\n\n`);
  },
};

export default def;
