import { Option } from 'commander';
import type { CommandDef } from '../../core/types.ts';
import { runStart, type StartOptions } from './_impl.ts';

const def: CommandDef = {
  name: 'start',
  description: 'Start all services (gateway, server, web) for the current instance',
  setup(cmd) {
    cmd.addOption(new Option('--port <port>', 'Force the web (Vite) service to use a specific port'));
    cmd.option('--desktop', 'Open the Electron desktop window after the stack is healthy');
  },
  action: async (opts: StartOptions) => {
    await runStart(opts);
  },
};

export default def;
