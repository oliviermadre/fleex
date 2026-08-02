import { c } from '../../../core/colors.ts';
import {
  COMPANION_PORT,
  companionLogFile,
  companionRepoDir,
  probeCompanion,
  readCompanionPid,
} from '../../../core/companion.ts';

import type { CommandDef } from '../../../core/types.ts';

const def: CommandDef = {
  name: 'status',
  description: 'Show whether the side-panel companion is running',
  action: async () => {
    const health = await probeCompanion();
    const pid = readCompanionPid();
    const state = health ? c.green('running') : c.dim('stopped');
    // hasApiKey is undefined on older hosts that don't report it.
    const keyLabel =
      !health || health.hasApiKey === undefined
        ? c.dim('-')
        : health.hasApiKey
          ? c.green('configured')
          : c.red('MISSING (add it to ~/.fleex/config, then restart)');
    process.stdout.write('\n');
    process.stdout.write(`  ${c.bold('fleex companion')}\n\n`);
    process.stdout.write(`  ${'Status'.padEnd(8)} ${state}\n`);
    process.stdout.write(`  ${'API key'.padEnd(8)} ${keyLabel}\n`);
    process.stdout.write(`  ${'URL'.padEnd(8)} http://localhost:${COMPANION_PORT}\n`);
    process.stdout.write(`  ${'PID'.padEnd(8)} ${pid ?? '-'}\n`);
    process.stdout.write(`  ${'Source'.padEnd(8)} ${c.dim(companionRepoDir())}\n`);
    process.stdout.write(`  ${'Log'.padEnd(8)} ${c.dim(companionLogFile())}\n\n`);
  },
};

export default def;
