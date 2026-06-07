#!/usr/bin/env bun
/**
 * fleex — Local dev-stack manager (TypeScript / Bun port)
 *
 * Auto-wiring entrypoint. The command tree is assembled by `buildProgram()`
 * (src/core/program.ts), which scans `src/commands/<...>/index.ts` and registers
 * each command based on its folder path:
 *
 *   src/commands/start/index.ts          → fleex start
 *   src/commands/ticket/index.ts         → fleex ticket   (parent group)
 *   src/commands/ticket/list/index.ts    → fleex ticket list
 *
 * Each command file must default-export a `CommandDef` (see src/core/types.ts).
 */
import { buildProgram } from './src/core/program.ts';

const program = await buildProgram();

// Default behaviour: show help when no command is given.
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

await program.parseAsync(process.argv);
