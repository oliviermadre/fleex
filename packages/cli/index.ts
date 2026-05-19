#!/usr/bin/env bun
/**
 * fleex — Local dev-stack manager (TypeScript / Bun port)
 *
 * Auto-wiring entrypoint. Scans `src/commands/<...>/index.ts` and registers
 * each command on the Commander tree based on its folder path:
 *
 *   src/commands/start/index.ts          → fleex start
 *   src/commands/ticket/index.ts         → fleex ticket   (parent group)
 *   src/commands/ticket/list/index.ts    → fleex ticket list
 *
 * Each command file must default-export a `CommandDef` (see src/core/types.ts).
 */
import path from 'node:path';
import { Command } from 'commander';
import type { CommandDef } from './src/core/types.ts';

const program = new Command();
program
  .name('fleex')
  .description('Local dev-stack manager (multi-instance) — manage gateway/server/web and tickets')
  .version('1.0.0')
  .showHelpAfterError()
  .enablePositionalOptions();

const commandsDir = path.join(import.meta.dir, 'src/commands');

/**
 * Returns the relative path of every `index.ts` file under `src/commands/`.
 * Sorted by depth so that parents are registered before their children.
 * Bun's native glob keeps us dependency-free.
 */
async function discoverCommands(): Promise<string[]> {
  const glob = new Bun.Glob('**/index.ts');
  const files: string[] = [];
  for await (const f of glob.scan({ cwd: commandsDir })) {
    files.push(f);
  }
  // Shallowest first so parent groups exist before subcommands are attached.
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
  cmd.action(async (...args: unknown[]) => {
    try {
      await def.action(...args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`fleex: ${msg}\n`);
      process.exit(1);
    }
  });
}

async function loadAndRegister(file: string): Promise<void> {
  const segments = file.replace(/\\/g, '/').replace(/\/index\.ts$/, '').split('/');
  const mod = await import(path.join(commandsDir, file));
  const def = mod.default as CommandDef | undefined;
  if (!def) {
    process.stderr.write(`fleex: command ${file} has no default export, skipping\n`);
    return;
  }

  // Walk the segment chain to attach to the right parent
  let parent: Command = program;
  for (let i = 0; i < segments.length - 1; i++) {
    parent = ensureSubcommand(parent, segments[i]!);
  }
  attachCommand(parent, def);
}

const files = await discoverCommands();
for (const f of files) {
  await loadAndRegister(f);
}

// Default behaviour: show help when no command is given.
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

await program.parseAsync(process.argv);
