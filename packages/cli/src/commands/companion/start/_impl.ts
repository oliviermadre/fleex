import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FLEEX_HOME } from '../../../core/instance.ts';
import { info, ok, warn, c } from '../../../core/colors.ts';
import { waitForService, killByPort } from '../../../core/process.ts';
import { computeFingerprint } from '../../../core/build-fingerprint.ts';
import {
  COMPANION_PORT,
  buildCompanionLaunch,
  decideCompanionAction,
  companionLogFile,
  companionPidFile,
  companionRepoDir,
  loadCompanionConfig,
  probeCompanion,
  stopCompanion,
} from '../../../core/companion.ts';

export interface CompanionStartOptions {
  /** Suppress the "already running" line (used by `fleex start`'s idempotent call). */
  quiet?: boolean;
}

/**
 * Start the companion if it isn't already serving. Idempotent: a healthy host on
 * the port is reused, never duplicated (the fixed port makes it a true singleton).
 *
 * Self-healing (see `decideCompanionAction` for the matrix): a running host is
 * restarted when it can't do its job — booted before ANTHROPIC_API_KEY was
 * configured, or running sources older than the repo we'd launch from now.
 * Without the second check the singleton survives every `git pull` while the
 * browser serves a fresh front-end, so new client features talk to an old
 * server that ignores them.
 */
export async function ensureCompanion(opts: CompanionStartOptions = {}): Promise<void> {
  const configEnv = loadCompanionConfig();
  const haveKey = Boolean(configEnv.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);

  const repoDir = companionRepoDir();

  const health = await probeCompanion();
  if (health) {
    const action = decideCompanionAction(health, { haveKey, localFingerprint: computeFingerprint(repoDir) });
    if (action.kind === 'restart') {
      warn(
        action.reason === 'no_api_key'
          ? 'Companion is running without an Anthropic key — restarting it to pick up ~/.fleex/config.'
          : `Companion is running stale code — restarting it to pick up ${repoDir}.`,
      );
      await stopCompanion();
    } else {
      if (action.kind === 'warn_stale') {
        warn("Companion is running stale code but is mid-conversation — run 'fleex companion stop' when idle.");
      }
      if (!opts.quiet) ok(`Companion already running on http://localhost:${COMPANION_PORT}`);
      return;
    }
  }

  const serverPath = path.join(repoDir, 'packages/sidepanel-host/src/server.ts');
  if (!fs.existsSync(serverPath)) {
    warn(
      `Companion sources not found at ${serverPath}. ` +
        `Install fleex (~/.fleex/repo) or set FLEEX_COMPANION_REPO to a checkout that has packages/sidepanel-host.`,
    );
    return;
  }

  if (!haveKey) {
    warn(
      `No ANTHROPIC_API_KEY found. Add it to ${path.join(FLEEX_HOME, 'config')} ` +
        `(ANTHROPIC_API_KEY=sk-ant-…) — the companion will boot but can't talk to Claude until it's set.`,
    );
  }

  // Clear any orphan still bound to the port before binding a fresh listener.
  killByPort(COMPANION_PORT);

  const launch = buildCompanionLaunch({
    repoDir,
    execPath: process.execPath,
    baseEnv: process.env,
    configEnv,
  });

  fs.mkdirSync(path.join(FLEEX_HOME, '.run'), { recursive: true });
  fs.mkdirSync(path.join(FLEEX_HOME, '.logs'), { recursive: true });

  const logPath = companionLogFile();
  const out = fs.openSync(logPath, 'a');
  const child = spawn(launch.bin, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  if (!child.pid) {
    warn('Failed to spawn the companion process.');
    return;
  }
  // Companion is a singleton → top-level pid file, not the per-instance helper.
  fs.writeFileSync(companionPidFile(), String(child.pid));

  info(`Starting companion from ${c.dim(repoDir)} ...`);
  const healthy = await waitForService(
    'companion',
    `http://localhost:${COMPANION_PORT}/health`,
    child.pid,
    logPath,
    15,
  );
  if (healthy) {
    ok(`Companion ready — http://localhost:${COMPANION_PORT}  ${c.dim(`(log: ${logPath})`)}`);
  } else {
    warn(`Companion did not become healthy. Check the log: ${logPath}`);
  }
}
