import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import type { CommandDef } from '../../core/types.ts';
import { c, info, ok, warn, die } from '../../core/colors.ts';
import { FLEEX_HOME, DEFAULT_REPO_DIR } from '../../core/instance.ts';
import { checkBun } from '../../core/version.ts';
import { installClaudeHooks } from '../../core/claude-hooks.ts';

function runLogged(cmd: string, args: string[], cwd: string, logPath: string, env?: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const out = fs.openSync(logPath, 'a');
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', out, out], env: env ?? process.env });
    child.on('exit', (code) => {
      fs.closeSync(out);
      resolve(code ?? 1);
    });
  });
}

function runInherit(cmd: string, args: string[], cwd: string): number {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  return r.status ?? 1;
}

const def: CommandDef = {
  name: 'self-update',
  description: 'Pull latest code and update the fleex CLI',
  action: async () => {
    const updateDir = DEFAULT_REPO_DIR;
    if (spawnSync('git', ['-C', updateDir, 'rev-parse', '--git-dir'], { stdio: 'ignore' }).status !== 0) {
      die(`Default repo not found at ${updateDir}. Nothing to update.`);
    }

    info('Updating fleex...');
    // Try rebase, fallback to plain pull
    let rc = runInherit('git', ['-C', updateDir, 'pull', '--rebase', 'origin', 'main'], updateDir);
    if (rc !== 0) {
      rc = runInherit('git', ['-C', updateDir, 'pull', 'origin', 'main'], updateDir);
      if (rc !== 0) die('git pull failed.');
    }
    ok('Code updated.');

    checkBun();
    info('Reinstalling dependencies...');
    const installLog = path.join(FLEEX_HOME, '.logs/self-update.log');
    fs.mkdirSync(path.dirname(installLog), { recursive: true });
    rc = await runLogged('bun', ['install'], updateDir, installLog);
    if (rc !== 0) die(`bun install failed. See ${installLog}`);
    ok('Dependencies updated.');

    info('Building packages...');
    rc = await runLogged('bun', ['run', 'build'], updateDir, installLog);
    if (rc !== 0) die(`Build failed. See ${installLog}`);
    ok('Build complete.');

    // Migrations (preserve bash behaviour: load .env then run migration script)
    const envFile = path.join(updateDir, '.env');
    if (fs.existsSync(envFile)) {
      info('Running database migrations...');
      const envExtra: NodeJS.ProcessEnv = { ...process.env };
      for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m) {
          const key = m[1]!;
          let val = m[2] ?? '';
          // Strip surrounding quotes if present
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          envExtra[key] = val;
        }
      }
      envExtra.FLEEX_SQLITE_PATH = envExtra.FLEEX_SQLITE_PATH ?? path.join(FLEEX_HOME, 'fleex.db');
      const migrateScript = path.join(updateDir, 'packages/server/src/infrastructure/migrations/cli-migrate.ts');
      rc = await runLogged('bun', ['run', migrateScript], updateDir, installLog, envExtra);
      if (rc === 0) ok('Migrations applied.');
      else warn(`Migration failed — check ${installLog}`);
    }

    // Ensure cli/fleex (the stable entrypoint) is executable and the bin
    // symlink points at it. This path is unchanged from the original bash
    // install, so upgrades from any prior version converge here.
    const binDst = path.join(FLEEX_HOME, 'bin/fleex');
    const entrySrc = path.join(updateDir, 'cli/fleex');
    if (fs.existsSync(entrySrc)) {
      try { fs.chmodSync(entrySrc, 0o755); } catch { /* ignore */ }
      try { fs.mkdirSync(path.dirname(binDst), { recursive: true }); } catch { /* ignore */ }
      // Repoint the symlink only if it's missing or pointing somewhere else.
      let needsRelink = true;
      try {
        const current = fs.readlinkSync(binDst);
        if (path.resolve(path.dirname(binDst), current) === entrySrc) needsRelink = false;
      } catch { /* missing or not a symlink */ }
      if (needsRelink) {
        try {
          if (fs.existsSync(binDst) || fs.lstatSync(binDst).isSymbolicLink()) {
            fs.unlinkSync(binDst);
          }
        } catch { /* ignore */ }
        try { fs.symlinkSync(entrySrc, binDst); } catch { /* ignore */ }
      }
    }

    // Refresh Claude Code hooks (idempotent) so the command path stays in sync after self-update.
    try {
      const res = installClaudeHooks();
      info(`Claude Code hooks refreshed in ${res.settingsPath} (${res.installed.length} events).`);
      if (res.backupPath) {
        warn(`Existing settings.json was invalid JSON — backup saved at ${res.backupPath}.`);
      }
    } catch (err) {
      warn(`Could not refresh Claude Code hooks: ${err instanceof Error ? err.message : String(err)}`);
    }

    process.stdout.write('\n');
    ok('fleex is up to date!');
    warn(`Running instances are not affected. Restart them if needed: ${c.bold('fleex restart')}`);
  },
};

export default def;
