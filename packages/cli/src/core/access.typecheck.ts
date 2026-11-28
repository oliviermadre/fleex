/**
 * Compile-time guard for the `access` contract (checked by `tsc`, never run).
 *
 * If `access` ever becomes optional on a leaf, the `@ts-expect-error` below has
 * nothing to expect and `tsc` fails: a new command could ship again without
 * saying whether it writes.
 */
import type { CommandDef } from './types.ts';

// @ts-expect-error — a runnable command must declare its access.
export const leafWithoutAccess: CommandDef = { name: 'x', description: 'x', action: () => {} };

// @ts-expect-error — a parent group never runs anything, so it declares none.
export const parentWithAccess: CommandDef = { name: 'x', description: 'x', action: () => {}, isParent: true, access: 'read' };

export const leaf: CommandDef = { name: 'x', description: 'x', action: () => {}, access: 'write' };
export const parent: CommandDef = { name: 'x', description: 'x', action: () => {}, isParent: true };
