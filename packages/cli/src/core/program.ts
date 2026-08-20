/**
 * Builds the fleex Commander tree without parsing argv or running anything.
 *
 * This is the same auto-wiring the CLI entrypoint (`index.ts`) uses, extracted
 * so other tools can introspect the command surface (e.g. `@fleex/mcp`, which
 * derives one MCP tool per leaf command from this tree). Keeping a single
 * builder guarantees the introspected surface and the executed CLI never drift.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import type { CommandDef } from './types.ts';
import { applyPrettyHelp, recordExtraHelp, setRootProgram } from './help.ts';
import { activateWorkspace } from './workspaces.ts';
import { isJsonMode, setJsonMode } from './colors.ts';

// `import.meta.dir` is a Bun runtime extra; it is erased when this module goes
// through a bundler/transform (e.g. Vitest), so fall back to the standard
// `import.meta.url`. Needed for the MCP parity test to load the real tree.
const moduleDir = import.meta.dir ?? path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(moduleDir, '..', 'commands');

// Derived from this file's own location rather than from the instance config,
// because the one caller needs it precisely when dependencies are missing — and
// reading the config would mean importing the modules that cannot load.
const repoDir = path.resolve(moduleDir, '..', '..', '..', '..');

/**
 * Returns the relative path of every `index.ts` file under `src/commands/`,
 * shallowest first so parent groups exist before their subcommands attach.
 */
async function discoverCommands(): Promise<string[]> {
  const glob = new Bun.Glob('**/index.ts');
  const files: string[] = [];
  for await (const f of glob.scan({ cwd: commandsDir })) {
    files.push(f);
  }
  files.sort((a, b) => {
    const da = a.split(path.sep).length;
    const db = b.split(path.sep).length;
    if (da !== db) return da - db;
    return a.localeCompare(b);
  });
  return files;
}

function ensureSubcommand(parent: Command, name: string): Command {
  const existing = parent.commands.find((c) => c.name() === name);
  if (existing) return existing;
  return parent.command(name);
}

function attachCommand(parent: Command, def: CommandDef): void {
  let cmd = parent.commands.find((c) => c.name() === def.name);
  if (!cmd) {
    cmd = parent.command(def.name);
  }
  cmd.description(def.description);
  if (def.aliases?.length) cmd.aliases(def.aliases);
  if (def.setup) def.setup(cmd);
  const hasOption = (long: string): boolean => cmd.options.some((o) => o.long === long);
  // Global `--json` flag on every command: machine-readable output for
  // programmatic consumers (the MCP tool layer). Hidden from the MCP tool
  // schemas (see @fleex/mcp generator) and injected automatically when needed.
  // Some commands (e.g. `repo list`, `workflow show`) declare their own `--json`
  // in setup — keep theirs and only add ours when absent, so registration never
  // conflicts. The preAction hook below activates JSON mode either way.
  if (!hasOption('--json')) {
    cmd.option('--json', 'Output machine-readable JSON instead of formatted text');
  }
  cmd.hook('preAction', (thisCommand) => {
    if (thisCommand.opts().json) setJsonMode(true);
  });
  if (def.workspaceAware) {
    if (!hasOption('--workspace')) {
      cmd.option('--workspace <name>', 'Target the named workspace instance (defaults to the is_default workspace)');
    }
    cmd.hook('preAction', (thisCommand) => {
      const ws = thisCommand.opts().workspace as string | undefined;
      if (ws) activateWorkspace(ws);
    });
  }
  if (def.extraHelp !== undefined) {
    const text = typeof def.extraHelp === 'function' ? def.extraHelp() : def.extraHelp;
    if (text && text.trim().length > 0) {
      cmd.addHelpText('after', text);
      // Keep the text retrievable for `fleex documentation` (notes field).
      recordExtraHelp(cmd, text);
    }
  }
  cmd.action(async (...args: unknown[]) => {
    try {
      await def.action(...args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isJsonMode()) {
        process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
      } else {
        process.stderr.write(`fleex: ${msg}\n`);
      }
      process.exit(1);
    }
  });
}

/** A command module that could not be imported, and why. */
export interface LoadFailure {
  /** Path relative to `src/commands`, e.g. `ticket/deliverable/add/index.ts`. */
  file: string;
  message: string;
  /** Bare specifier that could not be resolved, when that is the cause. */
  missingPackage: string | null;
}

/** `Cannot find module '<spec>' from '<importer>'` — Bun's resolution failure. */
const CANNOT_FIND_MODULE = /Cannot find module '([^']+)'/;

/**
 * The unresolved package behind a failure, or `null` for any other cause.
 *
 * A bare specifier means a dependency is not installed, which is one condition
 * affecting the whole tree at once. A relative specifier means that one module is
 * genuinely broken, and is reported on its own — collapsing the two would hide a
 * real bug inside a generic "run bun install".
 */
export function missingPackageFrom(message: string): string | null {
  const spec = CANNOT_FIND_MODULE.exec(message)?.[1];
  if (!spec) return null;
  return spec.startsWith('.') || spec.startsWith('/') ? null : spec;
}

/**
 * What to print after the scan, or `null` when everything loaded.
 *
 * Failures caused by uninstalled dependencies are stated once. There were
 * fifteen of them on a fresh checkout — one line per module, each naming the same
 * missing package, none of them saying what to do about it.
 */
export function describeLoadFailures(failures: LoadFailure[], repoDir: string): string | null {
  if (failures.length === 0) return null;

  const lines: string[] = [];

  // A module broken on its own terms keeps its own line: the file is the useful
  // part of that report, and there is nothing generic to advise.
  for (const f of failures.filter((f) => f.missingPackage === null)) {
    lines.push(`fleex: command ${f.file} failed to load, skipping — ${f.message}`);
  }

  const missing = failures.filter((f) => f.missingPackage !== null);
  if (missing.length > 0) {
    const packages = [...new Set(missing.map((f) => f.missingPackage!))].sort();
    // Top-level group names, which is how the reader thinks about what vanished
    // from `--help` — not the module paths that produced the error.
    const groups = [...new Set(missing.map((f) => f.file.split('/')[0]!))].sort();
    lines.push(
      `fleex: ${missing.length} command${missing.length > 1 ? 's' : ''} unavailable — `
      + `dependencies are not installed (${packages.join(', ')}).`,
    );
    lines.push(`       Missing: ${groups.join(', ')}`);
    lines.push(`       Fix: cd ${repoDir} && bun install`);
  }

  return lines.join('\n');
}

async function loadAndRegister(
  program: Command,
  file: string,
  failures: LoadFailure[],
): Promise<void> {
  const segments = file.replace(/\\/g, '/').replace(/\/index\.ts$/, '').split('/');

  // One unloadable command must not take the CLI with it.
  //
  // Every command module is imported at startup, so a single import failure used
  // to kill every command at once — including `self-update`, the command that
  // repairs the usual causes. That made the one thing able to fix the problem
  // unreachable. Now the group disappears and the rest of the CLI still works.
  //
  // Collected rather than printed here: on a fresh checkout every module fails
  // for the same reason, and fifteen identical lines describe the symptom without
  // naming the cure. `describeLoadFailures` states it once, with the fix.
  let mod: { default?: CommandDef };
  try {
    mod = await import(path.join(commandsDir, file));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ file, message, missingPackage: missingPackageFrom(message) });
    return;
  }

  const def = mod.default as CommandDef | undefined;
  if (!def) {
    failures.push({ file, message: 'no default export', missingPackage: null });
    return;
  }

  let parent: Command = program;
  for (let i = 0; i < segments.length - 1; i++) {
    parent = ensureSubcommand(parent, segments[i]!);
  }
  attachCommand(parent, def);
}

/**
 * Construct and return the fully-wired root `Command`. Does NOT parse argv,
 * print help, or exit — the caller decides what to do with the tree.
 */
export async function buildProgram(): Promise<Command> {
  const program = new Command();
  program
    .name('fleex')
    .description('Local dev-stack manager (multi-instance) — manage gateway/server/web and tickets')
    .version('1.0.0')
    .showHelpAfterError()
    .enablePositionalOptions();

  const files = await discoverCommands();
  const failures: LoadFailure[] = [];
  for (const f of files) {
    await loadAndRegister(program, f, failures);
  }

  const report = describeLoadFailures(failures, repoDir);
  if (report) process.stderr.write(`${report}\n`);

  // Install the pretty help formatter across the whole tree after every command
  // has been registered (so subcommand options are visible to the formatter).
  setRootProgram(program);
  applyPrettyHelp(program);

  return program;
}
