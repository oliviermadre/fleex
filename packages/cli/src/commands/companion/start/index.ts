import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { ensureCompanion } from './_impl.ts';

const SECTION = chalk.bold.yellow;

const def: CommandDef = {
  name: 'start',
  description: 'Start the side-panel companion (idempotent; reused if already running)',
  extraHelp: `\n${SECTION('Idempotent:')}
  A healthy companion on the fixed port is reused, never duplicated. The same
  singleton serves all workspaces, so you only ever need one.
`,
  action: async () => {
    await ensureCompanion();
  },
};

export default def;
