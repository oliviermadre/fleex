/**
 * Contract tests for `CommandDef.access`, against the REAL command tree.
 *
 * 1. Every runnable command declares its access. The type already refuses a
 *    leaf without one; this is the net for anything the type cannot see (a
 *    command registered through a cast, a factory that forgets to forward it).
 *
 * 2. Moving the MCP annotations from the old verb lists (`MUTATING_LEAVES`,
 *    `DESTRUCTIVE_LEAVES`) to `access` changed nothing on the default surface,
 *    except for the commands listed in `CORRECTED`: they write, and the verb
 *    list announced them read-only to every MCP client. The fixture is the
 *    `tools/list` annotations captured before the migration.
 *
 * Runs under Bun only (see `vitest.bun.config.ts`).
 */
import { describe, it, expect } from 'vitest';
import type { Command } from 'commander';
import { buildProgram } from '@fleex/cli/program';
import { getCommandAccess } from '@fleex/cli/access';
import { generateTools } from '../src/generator.ts';
import { listTools } from '../src/mcp-handlers.ts';
import before from './fixtures/annotations-before-access.json' with { type: 'json' };

const root = await buildProgram();

/** Commands that were mis-announced as read-only by the verb heuristic. */
const CORRECTED: Record<string, { readOnlyHint: boolean; destructiveHint: boolean }> = {
  fleex_ticket_comment_delete: { readOnlyHint: false, destructiveHint: true },
  fleex_ticket_mention_ack: { readOnlyHint: false, destructiveHint: false },
  fleex_ticket_mention_wait: { readOnlyHint: false, destructiveHint: false },
  fleex_ticket_todo_assign: { readOnlyHint: false, destructiveHint: false },
  fleex_ticket_todo_done: { readOnlyHint: false, destructiveHint: false },
  fleex_ticket_todo_reopen: { readOnlyHint: false, destructiveHint: false },
  fleex_epic_add_ticket: { readOnlyHint: false, destructiveHint: false },
  fleex_epic_remove_ticket: { readOnlyHint: false, destructiveHint: false },
  fleex_epic_add_board: { readOnlyHint: false, destructiveHint: false },
  fleex_epic_remove_board: { readOnlyHint: false, destructiveHint: false },
  // `--save <ticket>` writes a deliverable: classed by its strictest mode.
  fleex_memory_compile: { readOnlyHint: false, destructiveHint: false },
};

function runnable(cmd: Command, path: string[] = []): Array<{ cmd: Command; path: string[] }> {
  const subs = cmd.commands.filter((c) => c.name() !== 'help');
  const out = subs.flatMap((c) => runnable(c, [...path, c.name()]));
  if (path.length > 0 && subs.length === 0) out.push({ cmd, path });
  return out;
}

describe('CommandDef.access', () => {
  it('is declared by every leaf command of the CLI', () => {
    const missing = runnable(root)
      .filter(({ cmd }) => getCommandAccess(cmd) === undefined)
      .map(({ path }) => `fleex ${path.join(' ')}`);
    expect(missing).toEqual([]);
  });

  it('keeps the default MCP surface annotations, apart from the listed corrections', () => {
    const now = Object.fromEntries(
      listTools(generateTools(root)).tools.map((t) => [
        t.name,
        { readOnlyHint: t.annotations.readOnlyHint, destructiveHint: t.annotations.destructiveHint },
      ]),
    );
    const expected = { ...(before as typeof now), ...CORRECTED };
    expect(Object.keys(now).sort()).toEqual(Object.keys(expected).sort());
    expect(now).toEqual(expected);
  });
});
