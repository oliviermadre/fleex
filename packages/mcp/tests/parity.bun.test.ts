/**
 * Contract test: every option Commander declares on an exposed leaf command
 * must be reachable from the generated tool surface.
 *
 * This is the regression guard for the `--no-blocked` class of bug: an option
 * existed on the CLI but no tool input could produce it, so an agent could
 * never unblock a ticket. Nothing here is hard-coded — the test walks the REAL
 * command tree, so the next option added to the CLI is covered for free, and
 * the next option *dropped* at the boundary fails the build by name.
 *
 * Runs under Bun only: `buildProgram()` uses `Bun.Glob` / `import.meta.dir`,
 * which do not resolve under Node. See `vitest.bun.config.ts`.
 */
import { describe, it, expect } from 'vitest';
import type { Command, Option } from 'commander';
import { buildProgram } from '@fleex/cli/program';
import { generateTools, DEFAULT_INCLUDE } from '../src/generator.ts';
import { buildArgv } from '../src/argv.ts';
import type { GeneratedTool } from '../src/types.ts';

/** Mirrors the generator's own exclusions — handled by the host, not the model. */
const HIDDEN_OPTION_LONGS = new Set(['--help', '--workspace', '--json']);

const root = await buildProgram();
const tools = generateTools(root);

/** Find the Commander leaf a tool was generated from. */
function leafFor(tool: GeneratedTool): Command {
  let cmd: Command = root;
  for (const name of tool.commandPath) {
    const next = cmd.commands.find((c) => c.name() === name);
    if (!next) throw new Error(`no command for path ${tool.commandPath.join(' ')}`);
    cmd = next;
  }
  return cmd;
}

/** Minimal input satisfying the required positionals, so buildArgv gets that far. */
function baseInput(tool: GeneratedTool): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const arg of tool.arguments) input[arg.key] = arg.variadic ? ['x'] : 'x';
  return input;
}

interface Case { tool: GeneratedTool; cmd: Command; option: Option; label: string }

const cases: Case[] = [];
for (const tool of tools) {
  const cmd = leafFor(tool);
  for (const option of cmd.options as Option[]) {
    if (option.long && HIDDEN_OPTION_LONGS.has(option.long)) continue;
    if (!(option.long ?? option.short)) continue;
    cases.push({ tool, cmd, option, label: `${tool.commandPath.join(' ')} ${option.long ?? option.short}` });
  }
}

describe('CLI ↔ tool surface parity', () => {
  it('exposes only the allowlisted groups (scope decision is deliberate)', () => {
    const groups = new Set(tools.map((t) => t.commandPath[0]));
    expect([...groups].sort()).toEqual([...DEFAULT_INCLUDE].sort());
  });

  it('generated a non-trivial surface (guards against an empty walk)', () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  it.each(cases)('$label is reachable from the tool schema', ({ tool, option }) => {
    const flag = option.long ?? option.short!;
    const spec = tool.options.find((o) => o.flag === flag || o.negateFlag === flag);
    expect(spec, `${flag} has no OptSpec — it is unreachable from a tool call`).toBeDefined();
    expect(
      tool.inputSchema.properties[spec!.key],
      `${flag} maps to input key "${spec!.key}" which is absent from the schema`,
    ).toBeDefined();

    // The flag must actually come out the other end for some input value.
    const takesValue = Boolean(option.required || option.optional);
    const value = takesValue ? (spec!.variadic ? ['v'] : 'v') : option.negate ? false : true;
    const argv = buildArgv(tool, { ...baseInput(tool), [spec!.key]: value });
    expect(argv, `no tool input produces ${flag}`).toContain(flag);
  });

  it.each(cases.filter((c) => c.option.negate))(
    '$label round-trips: true sets, false clears',
    ({ tool, option }) => {
      const negFlag = option.long!;
      const spec = tool.options.find((o) => o.negateFlag === negFlag || o.flag === negFlag)!;
      const input = baseInput(tool);

      expect(buildArgv(tool, { ...input, [spec.key]: false })).toContain(negFlag);
      if (spec.negateFlag) {
        // Paired with a positive form — both directions must be expressible.
        expect(buildArgv(tool, { ...input, [spec.key]: true })).toContain(spec.flag);
      }
    },
  );

  it('never emits a flag Commander does not declare', () => {
    for (const tool of tools) {
      const declared = new Set(
        (leafFor(tool).options as Option[]).flatMap((o) => [o.long, o.short].filter(Boolean) as string[]),
      );
      for (const spec of tool.options) {
        expect(declared, `${tool.name}: ${spec.flag} is not a real CLI flag`).toContain(spec.flag);
        if (spec.negateFlag) {
          expect(declared, `${tool.name}: ${spec.negateFlag} is not a real CLI flag`).toContain(spec.negateFlag);
        }
      }
    }
  });

  it('covers the reported regression: ticket/epic update can clear blocked and favorite', () => {
    for (const path of [['ticket', 'update'], ['epic', 'update']]) {
      const tool = tools.find((t) => t.commandPath.join(' ') === path.join(' '))!;
      expect(tool, `${path.join(' ')} is not exposed`).toBeDefined();
      for (const key of ['blocked', 'favorite']) {
        const argv = buildArgv(tool, { ...baseInput(tool), [key]: false });
        expect(argv).toContain(`--no-${key}`);
      }
    }
  });
});
