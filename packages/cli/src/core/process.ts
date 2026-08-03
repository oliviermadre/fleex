import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

import { err, c } from './colors.ts';
import { pidFile, type InstanceContext } from './instance.ts';

export function savePid(svc: string, pid: number, ctx?: InstanceContext): void {
  fs.writeFileSync(pidFile(svc, ctx), String(pid));
}

export function removePid(svc: string, ctx?: InstanceContext): void {
  try {
    fs.unlinkSync(pidFile(svc, ctx));
  } catch {
    // ignore
  }
}

export function readPid(svc: string, ctx?: InstanceContext): number | null {
  const p = pidFile(svc, ctx);
  if (!fs.existsSync(p)) return null;
  try {
    const v = parseInt(fs.readFileSync(p, 'utf8').trim(), 10);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Returns true if `pid` is alive (process.kill with signal 0). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isRunning(svc: string, ctx?: InstanceContext): boolean {
  const pid = readPid(svc, ctx);
  return pid !== null && isAlive(pid);
}

/**
 * Best-effort recursive descendant lookup via `pgrep -P`. Returns empty array
 * if pgrep is missing.
 */
function children(pid: number): number[] {
  const r = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout
    .split('\n')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

/** Recursively kill `pid` and all its descendants with `signal`. */
export function killTree(pid: number, signal: NodeJS.Signals | number = 'SIGTERM'): void {
  for (const child of children(pid)) {
    killTree(child, signal);
  }
  try {
    process.kill(pid, signal);
  } catch {
    // process already gone
  }
}

/** Try to kill an entire process group; ignore failures (no PGID available). */
export function killGroup(pid: number, signal: NodeJS.Signals | number = 'SIGTERM'): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // not a process group leader; caller will fall back to killTree
  }
}

/**
 * SIGKILL anything still bound to `port` (TCP). Best-effort, needs `lsof`.
 * Catches orphans that escaped the PID/group kill (e.g. a `bun --watch` worker
 * reparented to init). Returns the PIDs it killed.
 */
export function killByPort(port: number): number[] {
  const r = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) return [];
  const pids = r.stdout
    .split('\n')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  return pids;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wait until `url` returns 2xx, or until `timeoutSec` seconds elapse, or
 * until `pid` dies. Prints last 15 lines of `logFilePath` on failure.
 */
export async function waitForService(
  name: string,
  url: string,
  pid: number,
  logFilePath: string,
  timeoutSec = 15,
): Promise<boolean> {
  const deadline = Date.now() + timeoutSec * 1000;
  let lastCode = '000';
  while (Date.now() < deadline) {
    if (!isAlive(pid)) {
      err(`${name} exited unexpectedly. Last 15 lines of log:`);
      tailLog(logFilePath, 15);
      return false;
    }
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      lastCode = String(res.status);
      if (res.status >= 200 && res.status < 300) return true;
    } catch {
      // ignore — service not up yet
    }
    await sleep(1000);
  }
  err(
    `${name} did not become healthy within ${timeoutSec}s (last HTTP ${lastCode}). Last 15 lines of log:`,
  );
  tailLog(logFilePath, 15);
  return false;
}

function tailLog(file: string, n: number): void {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const slice = lines.slice(Math.max(0, lines.length - n));
    for (const line of slice) {
      process.stderr.write(`  ${c.dim(line)}\n`);
    }
  } catch {
    // no log file — nothing to print
  }
}
