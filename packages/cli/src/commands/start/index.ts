import { Option } from 'commander';

import { runStart, type StartOptions } from './_impl.ts';

import type { CommandDef } from '../../core/types.ts';

const def: CommandDef = {
  name: 'start',
  description: 'Start all services (gateway, server, web) for the current instance',
  setup(cmd) {
    cmd.addOption(
      new Option('--port <port>', 'Force the web (Vite) service to use a specific port'),
    );
    cmd.option('--desktop', 'Open the Electron desktop window after the stack is healthy');
    cmd.option(
      '--workspace <name>',
      'Use the named workspace from ~/.fleex/workspaces.json (defaults to the is_default workspace)',
    );
  },
  action: async (opts: StartOptions) => {
    await runStart(opts);
  },
};

export default def;
