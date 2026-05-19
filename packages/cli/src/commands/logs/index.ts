import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { CommandDef } from '../../core/types.ts';
import { die } from '../../core/colors.ts';
import { resolveInstance, ensureDirs, logFile } from '../../core/instance.ts';

const def: CommandDef = {
  name: 'logs',
  description: 'Tail logs (all services, or a specific one via [service])',
  setup(cmd) {
    cmd.argument('[service]', 'Service to tail (gateway | server | web). Omit for all.');
  },
  action: async (service: string | undefined) => {
    const ctx = resolveInstance();
    ensureDirs(ctx);

    let files: string[];
    if (service) {
      const lf = logFile(service, ctx);
      if (!fs.existsSync(lf)) {
        die(`No log file for '${service}' in instance '${ctx.instanceSlug}'.`);
      }
      files = [lf];
    } else {
      if (!fs.existsSync(ctx.instanceLog)) {
        die(`No logs found for instance '${ctx.instanceSlug}'.`);
      }
      files = fs
        .readdirSync(ctx.instanceLog)
        .filter((f) => f.endsWith('.log'))
        .map((f) => path.join(ctx.instanceLog, f));
      if (files.length === 0) die(`No logs found for instance '${ctx.instanceSlug}'.`);
    }

    // Use `tail -f` directly — it's available on every POSIX system the
    // bash script ran on, and supports multi-file streaming with file headers.
    const child = spawn('tail', ['-f', ...files], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 0));
  },
};

export default def;
