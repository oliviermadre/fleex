import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { Option } from 'commander';

import { c, info, ok, warn, die } from '../../../core/colors.ts';
import { resolveInstance, ensureDirs } from '../../../core/instance.ts';
import { findFreePort } from '../../../core/ports.ts';
import {
  HUB_LOG_FILE,
  HUB_CLIENTS_FILE,
  readHubState,
  writeHubState,
  isAlive,
  clearHubState,
  readClientsFile,
} from '../_state.ts';

export interface HubStartOptions {
  port?: string;
}

export async function runHubStart(opts: HubStartOptions = {}): Promise<void> {
  const ctx = resolveInstance();
  ensureDirs(ctx);

  const existing = readHubState();
  if (existing && isAlive(existing.pid)) {
    warn(`Event hub already running on port ${existing.port} (PID ${existing.pid}).`);
    info(
      `Use ${c.bold('fleex hub status')} for details, ${c.bold('fleex hub stop')} to shut down.`,
    );
    return;
  }
  if (existing) {
    // Stale state file — clean it up.
    clearHubState();
  }

  let port: number;
  if (opts.port !== undefined) {
    const n = parseInt(opts.port, 10);
    if (!Number.isFinite(n) || n < 1 || n > 65535) {
      die(`Invalid port number: ${opts.port} (must be 1-65535)`);
    }
    port = n;
  } else {
    port = await findFreePort();
  }

  const url = `ws://127.0.0.1:${port}/events`;

  const hubMain = path.join(ctx.repoDir, 'packages/event-hub/src/main.ts');
  if (!fs.existsSync(hubMain)) {
    die(`Event hub entrypoint not found at ${hubMain}. Run from the Fleex repo.`);
  }

  fs.mkdirSync(path.dirname(HUB_LOG_FILE), { recursive: true });
  const out = fs.openSync(HUB_LOG_FILE, 'a');

  const child = spawn('bun', ['run', hubMain], {
    cwd: ctx.repoDir,
    env: {
      ...process.env,
      FLEEX_EVENT_HUB_PORT: String(port),
    },
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();

  const pid = child.pid;
  if (!pid) die('Failed to spawn the event hub process.');

  writeHubState({
    pid: pid as number,
    port,
    url,
    startedAt: Date.now(),
    logFile: HUB_LOG_FILE,
  });

  // Tiny grace period to surface immediate spawn failures (e.g. port in use).
  await new Promise((r) => setTimeout(r, 300));
  if (!isAlive(pid as number)) {
    clearHubState();
    die(`Event hub died immediately. Check the log: ${HUB_LOG_FILE}`);
  }

  const clientCount = readClientsFile().clients.length;
  ok(`Event hub started on port ${c.bold(String(port))} (PID ${pid}).`);
  process.stdout.write('\n');
  process.stdout.write(`  ${c.cyan('URL'.padEnd(20))} ${url}\n`);
  process.stdout.write(`  ${c.cyan('Clients file'.padEnd(20))} ${HUB_CLIENTS_FILE}\n`);
  process.stdout.write(`  ${c.cyan('Authorized'.padEnd(20))} ${clientCount} client(s)\n`);
  process.stdout.write(`  ${c.cyan('Log'.padEnd(20))} ${HUB_LOG_FILE}\n`);
  process.stdout.write('\n');
  if (clientCount === 0) {
    warn(`No clients authorized yet. Provision one with: ${c.bold('fleex hub client add <name>')}`);
  } else {
    info(
      `Use ${c.bold('fleex hub client list')} to see who's allowed, ${c.bold('fleex hub status')} for live state.`,
    );
  }
}

export function setupOptions(cmd: import('commander').Command): void {
  cmd.addOption(
    new Option(
      '--port <port>',
      'Force the hub to listen on a specific port (default: random free port)',
    ),
  );
}
