#!/usr/bin/env bun
/**
 * Export the entire Fleex knowledge base (boards, epics, tickets, public
 * discussions, deliverables, agents, workflows) from the configured storage
 * driver into a deterministic OKF v0.1 bundle under `~/.fleex/okf`.
 *
 * Usage (driver + credentials come from the environment — set them yourself, or
 * let `fleex okf generate --workspace <name>` inject them from workspaces.json):
 *   FLEEX_STORAGE_DRIVER=supabase \
 *   FLEEX_SUPABASE_URL=… FLEEX_SUPABASE_KEY=… \
 *   bun packages/server/src/scripts/export-okf.ts [--out <dir>] [--dry-run] [--quiet]
 *
 * Determinism: data access goes through the existing storage adapters (so the
 * snake_case→camelCase mapping never diverges from migrations); the rendering
 * is a pure DTO→string transform (`buildBundle`). Same DB ⇒ byte-identical
 * output. See spec §7.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { FLEEX_DIR } from '@fleex/shared';
import type { LoggerPort } from '../application/ports/logger.port.js';
import { resolveStorageDriver } from '../infrastructure/adapters/storage-factory.js';
import { buildBundle } from './okf/build-bundle.js';
import { loadOkfInput } from './okf/load-input.js';

interface Args {
  out: string;
  dryRun: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const defaultOut = join(homedir(), FLEEX_DIR, 'okf');
  const args: Args = { out: defaultOut, dryRun: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i] ?? defaultOut;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--quiet') args.quiet = true;
  }
  return args;
}

/** Console logger for the storage connection; silenced by `--quiet`. */
function makeLogger(quiet: boolean): LoggerPort {
  return {
    info(msg: string, meta?: Record<string, unknown>) {
      if (!quiet) console.log(`[okf] ${msg}`, meta ? JSON.stringify(meta) : '');
    },
    warn(msg: string, meta?: Record<string, unknown>) {
      console.warn(`[okf] WARN: ${msg}`, meta ? JSON.stringify(meta) : '');
    },
    error(msg: string, meta?: Record<string, unknown>) {
      console.error(`[okf] ERROR: ${msg}`, meta ? JSON.stringify(meta) : '');
    },
    debug() {
      /* quiet by default — debug noise is not useful for an export */
    },
  } as LoggerPort;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const log = (msg: string) => {
    if (!args.quiet) console.log(`[okf] ${msg}`);
  };

  const driver = resolveStorageDriver();
  log(`Reading knowledge from ${driver}…`);

  const { input, close } = await loadOkfInput(driver, makeLogger(args.quiet));

  try {
    log(
      `Loaded: ${input.boards.length} boards, ${input.epics.length} epics, ` +
        `${input.tickets.length} tickets, ${input.deliverables.length} deliverables, ` +
        `${input.personas.length} personas, ${input.panels.length} panels, ` +
        `${input.skills.length} skills, ${input.workflows.length} workflows.`,
    );

    const files = buildBundle(input);
    log(`Rendered ${files.length} files.`);

    if (args.dryRun) {
      log('--dry-run: not writing. Planned files:');
      for (const f of files) console.log(`  ${f.path}`);
      return;
    }

    await cleanDir(args.out);
    for (const file of files) {
      const full = join(args.out, file.path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, file.content, 'utf8');
    }
    log(`Wrote ${files.length} files to ${args.out}`);
  } finally {
    await close();
  }
}

/** Remove every entry in `dir` except a top-level `.git` folder (spec §7.6). */
async function cleanDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((e) => e.name !== '.git')
      .map((e) => rm(join(dir, e.name), { recursive: true, force: true })),
  );
}

main().catch((err) => {
  console.error('[okf] Export failed:', err);
  process.exit(1);
});
