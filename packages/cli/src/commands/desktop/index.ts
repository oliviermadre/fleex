import fs from 'node:fs';
import path from 'node:path';
import type { CommandDef } from '../../core/types.ts';
import { info, die, warn } from '../../core/colors.ts';
import { FLEEX_HOME, resolveInstance, ensureDirs } from '../../core/instance.ts';
import { loadPorts } from '../../core/ports.ts';
import { isRunning } from '../../core/process.ts';
import { launchDesktop } from './_impl.ts';

const def: CommandDef = {
  name: 'desktop',
  description: 'Open the Electron desktop window (starts stack if not running)',
  action: async () => {
    const ctx = resolveInstance();
    ensureDirs(ctx);

    // Try the current-resolved instance first.
    const ports = loadPorts(ctx);
    if (ports && isRunning('server', ctx)) {
      info(`Attaching desktop to running instance [${ctx.instanceSlug}]...`);
      await launchDesktop({ web: ports.web });
      return;
    }

    // Otherwise scan ~/.fleex/.run for any other running instance.
    const runBase = path.join(FLEEX_HOME, '.run');
    if (!fs.existsSync(runBase)) {
      info('No running instance found. Run `fleex start --desktop` to launch.');
      return;
    }

    const runningSlugs: string[] = [];
    for (const entry of fs.readdirSync(runBase)) {
      const pidPath = path.join(runBase, entry, 'server.pid');
      if (!fs.existsSync(pidPath)) continue;
      try {
        const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
        process.kill(pid, 0);
        runningSlugs.push(entry);
      } catch {
        // not alive
      }
    }

    if (runningSlugs.length === 1) {
      const slug = runningSlugs[0]!;
      info(`Found running instance: ${slug}`);
      // Load that instance's ports
      const portsFile = path.join(runBase, slug, 'ports.json');
      try {
        const j = JSON.parse(fs.readFileSync(portsFile, 'utf8'));
        await launchDesktop({ web: j.web });
      } catch {
        die(`Could not read ports for instance ${slug}.`);
      }
    } else if (runningSlugs.length > 1) {
      warn('Multiple running instances found:');
      for (const s of runningSlugs) process.stdout.write(`  - ${s}\n`);
      die('Stop other instances or specify which one to use.');
    } else {
      info('No running instance found. Use `fleex start --desktop`.');
    }
  },
};

export default def;
