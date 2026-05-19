import fs from 'node:fs';
import path from 'node:path';
import { info, warn, ok } from '../../core/colors.ts';
import { FLEEX_HOME, resolveInstance, ensureDirs } from '../../core/instance.ts';
import { SERVICES } from '../../core/ports.ts';
import { isAlive, killGroup, killTree, sleep } from '../../core/process.ts';

export async function stopInstance(slug: string): Promise<void> {
  const runDir = path.join(FLEEX_HOME, '.run', slug);
  let stopped = 0;

  for (const svc of SERVICES) {
    const pf = path.join(runDir, `${svc}.pid`);
    if (!fs.existsSync(pf)) continue;
    let pid: number;
    try {
      pid = parseInt(fs.readFileSync(pf, 'utf8').trim(), 10);
    } catch {
      try { fs.unlinkSync(pf); } catch { /* ignore */ }
      continue;
    }
    if (isAlive(pid)) {
      // 1) kill the whole process group when possible
      killGroup(pid, 'SIGTERM');
      // 2) recursive fallback
      killTree(pid, 'SIGTERM');
      await sleep(200);
      // 3) escalate to SIGKILL if anyone survived
      if (isAlive(pid)) {
        killGroup(pid, 'SIGKILL');
        killTree(pid, 'SIGKILL');
      }
      info(`[${slug}] Stopped ${svc} (PID ${pid})`);
      stopped += 1;
    }
    try { fs.unlinkSync(pf); } catch { /* ignore */ }
  }

  try { fs.unlinkSync(path.join(runDir, 'ports.json')); } catch { /* ignore */ }

  if (stopped === 0) warn(`[${slug}] No services were running.`);
  else ok(`[${slug}] All services stopped.`);
}

export async function stopAllInstances(): Promise<void> {
  const runBase = path.join(FLEEX_HOME, '.run');
  if (!fs.existsSync(runBase)) {
    warn('No instances found.');
    return;
  }
  const entries = fs.readdirSync(runBase).filter((e) => {
    return fs.statSync(path.join(runBase, e)).isDirectory();
  });
  if (entries.length === 0) {
    warn('No instances found.');
    return;
  }
  for (const slug of entries) {
    await stopInstance(slug);
  }
}

export async function stopCurrent(): Promise<void> {
  const ctx = resolveInstance();
  ensureDirs(ctx);
  await stopInstance(ctx.instanceSlug);
}
