/**
 * Builds the fleex Commander tree without parsing argv or running anything.
 *
 * This is the same auto-wiring the CLI entrypoint (`index.ts`) uses, extracted
 * so other tools can introspect the command surface (e.g. `@fleex/mcp`, which
 * derives one MCP tool per leaf command from this tree). Keeping a single
 * builder guarantees the introspected surface and the executed CLI never drift.
 */
import path from 'node:path';
import { Command } from 'commander';
import type { CommandDef } from './types.ts';
import { applyPrettyHelp, setRootProgram } from './help.ts';
import { activateWorkspace } from './workspaces.ts';
import { isJsonMode, setJsonMode } from './colors.ts';

const commandsDir = path.join(import.meta.dir, '..', 'commands');

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
    if (text && text.trim().length > 0) cmd.addHelpText('after', text);
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

async function loadAndRegister(program: Command, file: string): Promise<void> {
  const segments = file.replace(/\\/g, '/').replace(/\/index\.ts$/, '').split('/');
  const mod = await import(path.join(commandsDir, file));
  const def = mod.default as CommandDef | undefined;
  if (!def) {
    process.stderr.write(`fleex: command ${file} has no default export, skipping\n`);
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
  for (const f of files) {
    await loadAndRegister(program, f);
  }

  // Install the pretty help formatter across the whole tree after every command
  // has been registered (so subcommand options are visible to the formatter).
  setRootProgram(program);
  applyPrettyHelp(program);

  return program;
}
