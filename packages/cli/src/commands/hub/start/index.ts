import type { CommandDef } from '../../../core/types.ts';
import { runHubStart, setupOptions, type HubStartOptions } from './_impl.ts';

const def: CommandDef = {
  name: 'start',
  description: 'Start the event hub process',
  setup(cmd) {
    setupOptions(cmd);
  },
  action: async (opts: HubStartOptions) => {
    await runHubStart(opts);
  },
};

export default def;
