import fs from 'node:fs';
import path from 'node:path';
import type { CommandDef } from '../../core/types.ts';
import { die } from '../../core/colors.ts';
import { FLEEX_HOME } from '../../core/instance.ts';
import { assertValidWorkspacesConfig } from '../../core/workspaces.ts';
import { stopAllInstances, stopCurrent, stopInstance } from './_impl.ts';

interface StopOptions {
  all?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'stop',
  description: 'Stop the current instance (or a named one with [name])',
  setup(cmd) {
    cmd.argument('[instance]', 'Instance slug to stop. Defaults to the current worktree.');
    cmd.option('--all', 'Stop every running instance');
  },
  action: async (instance: string | undefined, opts: StopOptions) => {
    if (opts.all) {
      await stopAllInstances();
      return;
    }
    if (instance) {
      const dir = path.join(FLEEX_HOME, '.run', instance);
      if (!fs.existsSync(dir)) {
        die(`Unknown instance '${instance}'. Use 'fleex status' to list instances.`);
      }
      await stopInstance(instance);
      return;
    }
    // Bare `fleex stop` resolves the current instance from the workspace config;
    // guard it. `--all` and explicit-slug stops above work on slugs directly and
    // stay available as an escape hatch when the config is broken.
    assertValidWorkspacesConfig();
    await stopCurrent();
  },
};

export default def;
