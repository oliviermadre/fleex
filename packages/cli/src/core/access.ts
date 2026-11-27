/**
 * The `access` each registered command declared (see `CommandAccess`).
 *
 * Kept off the Commander object itself (a WeakMap, like `extraHelp`) so every
 * consumer of the built tree — `fleex documentation`, the MCP generator —
 * reads the same declaration through one accessor.
 */
import type { Command } from 'commander';
import type { CommandAccess } from './types.ts';

export type { CommandAccess };

const accessByCommand = new WeakMap<Command, CommandAccess>();

export function recordCommandAccess(cmd: Command, access: CommandAccess): void {
  accessByCommand.set(cmd, access);
}

/** The declared access, or undefined for a parent group (or an unregistered command). */
export function getCommandAccess(cmd: Command): CommandAccess | undefined {
  return accessByCommand.get(cmd);
}
