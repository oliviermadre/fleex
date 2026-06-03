import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import type { CommandDef } from '../../core/types.ts';
import { c, info, ok, warn, die } from '../../core/colors.ts';
import { FLEEX_HOME, DEFAULT_REPO_DIR } from '../../core/instance.ts';
import { checkBun } from '../../core/version.ts';
import { installClaudeHooks } from '../../core/claude-hooks.ts';
import {
  parseWorkspacesFile,
  resolveWorkspace,
  bootstrapWorkspacesFromEnv,
  workspacesFilePath,
} from '../../core/workspaces.ts';

interface SelfUpdateOptions {
  workspace?: string;
  allWorkspaces?: boolean;
}

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

/** Run DB migrations against the DB described by `envVars`. */
async function runMigrations(
  label: string | null,
  envVars: Record<string, string>,
  updateDir: string,
  installLog: string,
): Promise<void> {
  info(`Running database migrations${label ? ` for workspace '${label}'` : ''}...`);
  const envExtra: NodeJS.ProcessEnv = { ...process.env, ...envVars };
  envExtra.FLEEX_SQLITE_PATH = envExtra.FLEEX_SQLITE_PATH ?? path.join(FLEEX_HOME, 'fleex.db');
  const migrateScript = path.join(updateDir, 'packages/server/src/infrastructure/migrations/cli-migrate.ts');
  const rc = await runLogged('bun', ['run', migrateScript], updateDir, installLog, envExtra);
  if (rc === 0) ok(`Migrations applied${label ? ` for '${label}'` : ''}.`);
  else warn(`Migration failed${label ? ` for '${label}'` : ''} — check ${installLog}`);
}

const def: CommandDef = {
  name: 'self-update',
  description: 'Pull latest code and update the fleex CLI',
  setup(cmd) {
    cmd.option('--workspace <name>', 'Migrate only the named workspace database (defaults to the is_default workspace)');
    cmd.option('--all-workspaces', 'Migrate the database of every workspace');
  },
  action: async (opts: SelfUpdateOptions = {}) => {
    const updateDir = DEFAULT_REPO_DIR;
    if (spawnSync('git', ['-C', updateDir, 'rev-parse', '--git-dir'], { stdio: 'ignore' }).status !== 0) {
      die(`Default repo not found at ${updateDir}. Nothing to update.`);
    }

    // Migrate legacy .env users to workspaces.json before anything else.
    const created = bootstrapWorkspacesFromEnv(path.join(updateDir, '.env'));
    if (created) {
      info(`Created ${workspacesFilePath()} from existing .env (workspace 'default').`);
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

    // Migrations — workspace-aware. Each workspace's env selects its DB.
    let workspaces = null;
    try {
      workspaces = parseWorkspacesFile();
    } catch (e) {
      warn(`Skipping migrations — ${e instanceof Error ? e.message : String(e)}`);
    }

    if (opts.allWorkspaces) {
      if (workspaces && workspaces.length > 0) {
        for (const ws of workspaces) {
          await runMigrations(ws.name, ws.env, updateDir, installLog);
        }
      } else {
        warn('No workspaces found to migrate.');
      }
    } else if (workspaces) {
      const ws = (() => {
        try {
          return resolveWorkspace(workspaces, opts.workspace);
        } catch (e) {
          return die(e instanceof Error ? e.message : String(e));
        }
      })();
      await runMigrations(ws.name, ws.env, updateDir, installLog);
    }
    // No workspaces.json and no .env → nothing to migrate (fresh/legacy).

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
