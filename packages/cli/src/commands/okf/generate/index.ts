import { spawn } from 'node:child_process';
import path from 'node:path';

import chalk from 'chalk';

import { info, ok, warn, die } from '../../../core/colors.ts';
import { FLEEX_HOME, resolveInstance } from '../../../core/instance.ts';
import { parseWorkspacesFile, resolveWorkspace, type Workspace } from '../../../core/workspaces.ts';

import type { CommandDef } from '../../../core/types.ts';
import type { Command } from 'commander';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

interface GenerateOptions {
  workspace?: string;
  out?: string;
  dryRun?: boolean;
  quiet?: boolean;
}

/**
 * Resolve which workspace's data to export. Returns `null` in legacy mode (no
 * workspaces.json) so the export falls back to the ambient environment.
 */
function pickWorkspace(name?: string): Workspace | null {
  let workspaces: Workspace[] | null;
  try {
    workspaces = parseWorkspacesFile();
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e));
  }
  if (workspaces === null) {
    if (name !== undefined) {
      return die(`--workspace '${name}' requested but no workspaces.json exists.`);
    }
    return null;
  }
  try {
    return resolveWorkspace(workspaces, name);
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e));
  }
}

const def: CommandDef = {
  name: 'generate',
  aliases: ['gen'],
  description: "Generate an OKF bundle from a workspace's data (driver auto-selected)",
  setup(cmd: Command) {
    cmd.option(
      '--workspace <name>',
      'Workspace whose storage driver supplies the data (defaults to the is_default workspace)',
    );
    cmd.option('--out <dir>', 'Output directory for the bundle (defaults to ~/.fleex/okf)');
    cmd.option('--dry-run', 'List the files that would be written, without writing them');
    cmd.option('--quiet', 'Suppress progress logs');
  },
  extraHelp: `\n${SECTION('How it works:')}
  The storage driver and credentials are read from the selected workspace in
  ${DIM('~/.fleex/workspaces.json')} — you never pass Supabase/SQLite env vars by hand.
  Re-running on an unchanged database yields a byte-identical bundle.

${SECTION('Examples:')}
  ${DIM('$')} fleex okf generate
  ${DIM('$')} fleex okf generate --workspace default --out ~/exports/fleex-okf
  ${DIM('$')} fleex okf generate --workspace tada --dry-run
`,
  async action(opts: GenerateOptions = {}) {
    const ws = pickWorkspace(opts.workspace);

    const { repoDir } = resolveInstance();
    const script = path.join(repoDir, 'packages/server/src/scripts/export-okf.ts');

    // Workspace env selects the driver (FLEEX_STORAGE_DRIVER + credentials).
    // Mirror self-update: default FLEEX_SQLITE_PATH so the sqlite driver finds
    // the conventional DB even when a workspace omits the explicit path.
    const env: NodeJS.ProcessEnv = { ...process.env, ...(ws?.env ?? {}) };
    env.FLEEX_SQLITE_PATH = env.FLEEX_SQLITE_PATH ?? path.join(FLEEX_HOME, 'fleex.db');

    const args = ['run', script];
    if (opts.out) args.push('--out', path.resolve(opts.out));
    if (opts.dryRun) args.push('--dry-run');
    if (opts.quiet) args.push('--quiet');

    if (!opts.quiet) {
      const label = ws ? ws.name : '(ambient env)';
      info(`Generating OKF bundle from workspace '${label}'…`);
    }

    const code = await new Promise<number>((resolve) => {
      const child = spawn('bun', args, { cwd: repoDir, stdio: 'inherit', env });
      child.on('exit', (c) => resolve(c ?? 1));
      child.on('error', (err) => {
        warn(`Failed to launch export: ${err.message}`);
        resolve(1);
      });
    });

    if (code !== 0) die(`OKF export failed (exit ${code}).`);
    if (!opts.dryRun) ok('OKF bundle generated.');
  },
};

export default def;
