import fs from 'node:fs';
import path from 'node:path';
import type { CommandDef } from '../../core/types.ts';
import { ok, warn, die } from '../../core/colors.ts';
import { FLEEX_HOME, resolveInstance } from '../../core/instance.ts';
import { SERVICES } from '../../core/ports.ts';
import { isAlive } from '../../core/process.ts';

interface RemoveOptions {
  allStopped?: boolean;
}

function instanceIsRunning(runDir: string): boolean {
  for (const svc of SERVICES) {
    const pf = path.join(runDir, `${svc}.pid`);
    if (!fs.existsSync(pf)) continue;
    try {
      const pid = parseInt(fs.readFileSync(pf, 'utf8').trim(), 10);
      if (Number.isFinite(pid) && isAlive(pid)) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

const def: CommandDef = {
  name: 'remove',
  description: 'Remove a stopped instance (its .run and .logs directories)',
  setup(cmd) {
    cmd.argument('[instance]', 'Instance slug to remove. Defaults to the current worktree.');
    cmd.option('--all-stopped', 'Remove every stopped instance');
  },
  action: async (instance: string | undefined, opts: RemoveOptions) => {
    if (opts.allStopped) {
      const runBase = path.join(FLEEX_HOME, '.run');
      if (!fs.existsSync(runBase)) {
        warn('No instances found.');
        return;
      }
      let removed = 0;
      for (const slug of fs.readdirSync(runBase)) {
        const runDir = path.join(runBase, slug);
        if (!fs.statSync(runDir).isDirectory()) continue;
        if (instanceIsRunning(runDir)) continue;
        fs.rmSync(runDir, { recursive: true, force: true });
        fs.rmSync(path.join(FLEEX_HOME, '.logs', slug), { recursive: true, force: true });
        ok(`Removed instance '${slug}'`);
        removed += 1;
      }
      if (removed === 0) warn('No stopped instances to remove.');
      else ok(`Removed ${removed} stopped instance(s).`);
      return;
    }

    const target = instance ?? resolveInstance().instanceSlug;
    const runDir = path.join(FLEEX_HOME, '.run', target);
    const logDir = path.join(FLEEX_HOME, '.logs', target);

    if (!fs.existsSync(runDir) && !fs.existsSync(logDir)) {
      die(`Unknown instance '${target}'. Use 'fleex status' to list instances.`);
    }

    if (instanceIsRunning(runDir)) {
      die(`Instance '${target}' is still running. Stop it first: fleex stop ${target}`);
    }

    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(logDir, { recursive: true, force: true });
    ok(`Removed instance '${target}'`);
  },
};

export default def;
