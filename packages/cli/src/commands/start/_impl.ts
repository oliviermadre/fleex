import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadDotEnv } from '../../core/env.ts';
import { activateWorkspace, assertValidWorkspacesConfig } from '../../core/workspaces.ts';
import { c, info, ok, warn, die } from '../../core/colors.ts';
import { checkBun } from '../../core/version.ts';
import {
  resolveInstance,
  ensureDirs,
  checkRepo,
  logFile,
  writeInstanceMeta,
} from '../../core/instance.ts';
import { SERVICES, allocatePorts, writePorts } from '../../core/ports.ts';
import { isRunning, savePid, waitForService } from '../../core/process.ts';
import { runStatus } from '../status/_impl.ts';
import { launchDesktop } from '../desktop/_impl.ts';
import { ensureCompanion } from '../companion/start/_impl.ts';
import { checkClaudeHooks, installClaudeHooks } from '../../core/claude-hooks.ts';

export interface StartOptions {
  port?: string;
  desktop?: boolean;
  workspace?: string;
}

export async function runStart(opts: StartOptions = {}): Promise<void> {
  // Refuse to proceed on a broken global config (e.g. >1 default workspace),
  // before any workspace activation or instance resolution.
  assertValidWorkspacesConfig();

  // Resolve & inject the workspace BEFORE the first resolveInstance() (which
  // caches the slug). In legacy mode (no workspaces.json) this is a no-op.
  activateWorkspace(opts.workspace);

  let forcedWebPort: number | undefined;
  if (opts.port !== undefined) {
    const n = parseInt(opts.port, 10);
    if (!Number.isFinite(n) || n < 1 || n > 65535) {
      die(`Invalid port number: ${opts.port} (must be 1-65535)`);
    }
    forcedWebPort = n;
  }

  checkBun();
  const ctx = resolveInstance();
  checkRepo(ctx);
  ensureDirs(ctx);

  // Refuse to start if any service is already running
  const already = SERVICES.some((svc) => isRunning(svc, ctx));
  if (already) {
    warn(`Instance '${ctx.instanceSlug}' is already running. Use 'fleex restart' to restart.`);
    await runStatus();
    return;
  }

  info('Installing dependencies...');
  await runCommand('bun', ['install', '--frozen-lockfile'], ctx.repoDir, logFile('install', ctx)).catch(async () => {
    await runCommand('bun', ['install'], ctx.repoDir, logFile('install', ctx));
  });
  ok('Dependencies installed.');

  // Claude Code hooks: install silently if missing. Non-blocking on failure.
  try {
    const status = checkClaudeHooks();
    if (!status.ok) {
      const res = installClaudeHooks();
      info(`Claude Code hooks installed in ${res.settingsPath} (${res.installed.length} events).`);
      if (res.backupPath) {
        warn(`Existing settings.json was invalid JSON — backup saved at ${res.backupPath}.`);
      }
    }
  } catch (err) {
    warn(`Could not install Claude Code hooks: ${err instanceof Error ? err.message : String(err)}`);
  }

  let ports = await allocatePorts(ctx);
  if (forcedWebPort !== undefined) {
    ports = { ...ports, web: forcedWebPort };
    writePorts(ports, ctx);
  }
  info(`Allocated ports — gateway:${ports.gateway}  server:${ports.server}  web:${ports.web}`);

  info(`Starting stack for ${c.bold(ctx.instanceSlug)}...`);

  // Load repo .env so installer-written vars (e.g. FLEEX_STORAGE_DRIVER) are
  // honoured. Non-override: the workspace env (already injected) wins.
  loadDotEnv(path.join(ctx.repoDir, '.env'));

  // Persist instance metadata for `fleex status` (workspace, driver, branch).
  writeInstanceMeta(
    {
      workspace: ctx.workspace,
      branch: ctx.branch,
      driver: process.env.FLEEX_STORAGE_DRIVER ?? 'json',
      startedAt: new Date().toISOString(),
    },
    ctx,
  );

  // Spawn each service detached, captured in its own log file.
  const env = { ...process.env };

  const gatewayProc = spawnService('gateway', ctx.repoDir, {
    ...env,
    GATEWAY_PORT: String(ports.gateway),
    FLEEX_CENTRAL_URL: `http://localhost:${ports.server}`,
  }, ['run', 'dev:gateway']);
  savePid('gateway', gatewayProc.pid!, ctx);

  const serverProc = spawnService('server', ctx.repoDir, {
    ...env,
    PORT: String(ports.server),
    HOST_GATEWAY_URL: `http://localhost:${ports.gateway}`,
    FLEEX_STORAGE_DRIVER: process.env.FLEEX_STORAGE_DRIVER ?? 'json',
  }, ['run', 'dev:server']);
  savePid('server', serverProc.pid!, ctx);

  const webProc = spawnService('web', ctx.repoDir, {
    ...env,
    VITE_DEV_PORT: String(ports.web),
    VITE_PROXY_TARGET: `http://localhost:${ports.server}`,
  }, ['run', 'dev:web']);
  savePid('web', webProc.pid!, ctx);

  info('Waiting for services to become healthy...');
  let healthy = await waitForService(
    'gateway',
    `http://localhost:${ports.gateway}/health`,
    gatewayProc.pid!,
    logFile('gateway', ctx),
    15,
  );
  if (healthy) {
    healthy = await waitForService(
      'server',
      `http://localhost:${ports.server}/health`,
      serverProc.pid!,
      logFile('server', ctx),
      15,
    );
  }
  if (healthy) {
    healthy = await waitForService(
      'web',
      `http://localhost:${ports.web}/`,
      webProc.pid!,
      logFile('web', ctx),
      15,
    );
  }

  process.stdout.write('\n');
  if (healthy) {
    ok(`Stack started! [${ctx.instanceSlug}]`);
  } else {
    warn(`Stack started with issues — some services may not be healthy. [${ctx.instanceSlug}]`);
  }
  process.stdout.write('\n');
  process.stdout.write(`  ${c.cyan('Service'.padEnd(10))} ${c.dim('URL'.padEnd(30))} Log\n`);
  process.stdout.write(`  ${c.cyan('gateway'.padEnd(10))} ${`http://localhost:${ports.gateway}`.padEnd(30)} ${c.dim(logFile('gateway', ctx))}\n`);
  process.stdout.write(`  ${c.cyan('server'.padEnd(10))} ${`http://localhost:${ports.server}`.padEnd(30)} ${c.dim(logFile('server', ctx))}\n`);
  process.stdout.write(`  ${c.cyan('web'.padEnd(10))} ${`http://localhost:${ports.web}`.padEnd(30)} ${c.dim(logFile('web', ctx))}\n`);
  process.stdout.write('\n');
  info(`Use ${c.bold('fleex status')} to check, ${c.bold('fleex stop')} to shut down.`);

  // Bring up the side-panel companion (backs the Chrome extension). Idempotent
  // and machine-wide: one process serves every instance/workspace, so repeated
  // `fleex start`s reuse the same healthy companion rather than spawning more.
  await ensureCompanion({ quiet: true });

  if (opts.desktop) {
    await launchDesktop({ web: ports.web });
  }
}

function spawnService(
  name: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  args: string[],
) {
  const ctx = resolveInstance();
  const out = fs.openSync(logFile(name, ctx), 'a');
  const child = spawn('bun', args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  return child;
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  logPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.openSync(logPath, 'a');
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', out, out] });
    child.on('exit', (code) => {
      fs.closeSync(out);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`));
    });
    child.on('error', reject);
  });
}
