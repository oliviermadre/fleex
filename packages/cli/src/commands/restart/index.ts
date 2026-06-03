import type { CommandDef } from '../../core/types.ts';
import { info } from '../../core/colors.ts';
import { activateWorkspace } from '../../core/workspaces.ts';
import { stopCurrent } from '../stop/_impl.ts';
import { sleep } from '../../core/process.ts';
import startDef from '../start/index.ts';

const def: CommandDef = {
  name: 'restart',
  description: 'Restart the current instance (stop then start with same options)',
  setup(cmd) {
    cmd.option('--port <port>', 'Force the web (Vite) service to use a specific port');
    cmd.option('--desktop', 'Open the Electron desktop window after the stack is healthy');
    cmd.option('--workspace <name>', 'Use the named workspace from ~/.fleex/workspaces.json (defaults to the is_default workspace)');
  },
  action: async (opts: { workspace?: string }) => {
    // Activate the workspace first so stopCurrent() resolves the right
    // (workspace@branch) instance to stop before we restart it.
    activateWorkspace(opts.workspace);
    info('Restarting stack...');
    await stopCurrent();
    await sleep(1000);
    await startDef.action(opts);
  },
};

export default def;
