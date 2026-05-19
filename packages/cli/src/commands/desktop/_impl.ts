import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { info, ok, warn } from '../../core/colors.ts';
import { resolveInstance, logFile } from '../../core/instance.ts';
import { savePid } from '../../core/process.ts';

interface DesktopInput {
  /** Web/Vite port — exposed to Electron as FLEEX_SERVER_PORT. */
  web: number;
}

/**
 * Start the Electron desktop window for the resolved instance.
 * Mirrors `_launch_desktop` from the bash CLI.
 */
export async function launchDesktop(ports: DesktopInput): Promise<boolean> {
  const ctx = resolveInstance();
  const desktopDir = path.join(ctx.repoDir, 'packages/desktop');
  const electronBin = path.join(desktopDir, 'node_modules/.bin/electron');

  if (!fs.existsSync(desktopDir)) {
    warn('packages/desktop not found.');
    return false;
  }

  if (!fs.existsSync(electronBin)) {
    info('Installing desktop dependencies...');
    await new Promise<void>((resolve) => {
      const out = fs.openSync(logFile('desktop-install', ctx), 'a');
      const child = spawn('bun', ['install'], {
        cwd: desktopDir,
        stdio: ['ignore', out, out],
      });
      child.on('exit', () => {
        fs.closeSync(out);
        resolve();
      });
    });
    if (!fs.existsSync(electronBin)) {
      warn(`Failed to install Electron. Check ${logFile('desktop-install', ctx)}`);
      return false;
    }
    ok('Desktop dependencies installed.');
  }

  info('Opening Electron desktop window...');
  const out = fs.openSync(logFile('desktop', ctx), 'a');
  const child = spawn(electronBin, [desktopDir], {
    cwd: ctx.repoDir,
    env: { ...process.env, FLEEX_SERVER_PORT: String(ports.web) },
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  savePid('desktop', child.pid!, ctx);
  ok(`Desktop window opened (PID ${child.pid})`);
  return true;
}
