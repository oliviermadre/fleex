/**
 * The classification of a leaf command as read-only or mutating is a security
 * control: the side panel only asks for confirmation when `mutating` is true,
 * and it ingests untrusted web-page content. A leaf wrongly marked read-only is
 * a prompt-injection hole, not a cosmetic bug.
 *
 * So this suite asserts the classification of EVERY leaf of the default include
 * set against a hand-checked table, and fails when a new CLI command appears
 * without a declared classification.
 *
 * Leaves are discovered from the filesystem rather than from `buildProgram()`:
 * that builder uses `Bun.Glob`, which does not exist under `vitest run` (node).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { generateTools, isMutatingLeaf, isDestructiveLeaf, leafSegments } from '../src/generator.ts';
import { toMcpTool } from '../src/mcp-handlers.ts';

const COMMANDS_DIR = fileURLToPath(new URL('../../cli/src/commands', import.meta.url));

interface Leaf {
  /** Command path relative to the root, e.g. ['ticket', 'comment-delete']. */
  commandPath: string[];
  dir: string;
}

/** A directory is a group when at least one child directory holds an index.ts. */
function childCommandDirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, 'index.ts')))
    .map((e) => e.name)
    .sort();
}

function collect(dir: string, rel: string[], leaves: Leaf[], all: Leaf[]): void {
  all.push({ commandPath: rel, dir });
  const children = childCommandDirs(dir);
  if (children.length === 0) {
    leaves.push({ commandPath: rel, dir });
    return;
  }
  for (const child of children) collect(path.join(dir, child), [...rel, child], leaves, all);
}

const LEAVES: Leaf[] = [];
const ALL_COMMAND_DIRS: Leaf[] = [];
for (const group of ['ticket', 'epic']) {
  collect(path.join(COMMANDS_DIR, group), [group], LEAVES, ALL_COMMAND_DIRS);
}

/**
 * Expected classification of every leaf of the default include set.
 *
 * `mutating` mirrors the side-panel confirmation gate; `destructive` mirrors the
 * MCP `destructiveHint`. Reversible writes (archive, move, update) mutate but do
 * not destroy.
 */
const EXPECTED: Record<string, { mutating: boolean; destructive: boolean }> = {
  'ticket archive': { mutating: true, destructive: false },
  'ticket boards': { mutating: false, destructive: false },
  'ticket comment': { mutating: true, destructive: false },
  'ticket comment-delete': { mutating: true, destructive: true },
  'ticket comments': { mutating: false, destructive: false },
  'ticket create': { mutating: true, destructive: false },
  'ticket delete': { mutating: true, destructive: true },
  'ticket deliverable add': { mutating: true, destructive: false },
  'ticket deliverable delete': { mutating: true, destructive: true },
  'ticket deliverable list': { mutating: false, destructive: false },
  'ticket deliverable show': { mutating: false, destructive: false },
  'ticket deliverable update': { mutating: true, destructive: false },
  'ticket import': { mutating: true, destructive: false },
  'ticket link': { mutating: true, destructive: false },
  'ticket list': { mutating: false, destructive: false },
  'ticket mention ack': { mutating: true, destructive: false },
  'ticket mention delete': { mutating: true, destructive: true },
  'ticket mention resolve': { mutating: true, destructive: false },
  'ticket mention run': { mutating: true, destructive: false },
  'ticket mention wait': { mutating: true, destructive: false },
  'ticket mentions': { mutating: false, destructive: false },
  'ticket move': { mutating: true, destructive: false },
  'ticket show': { mutating: false, destructive: false },
  'ticket unarchive': { mutating: true, destructive: false },
  'ticket unlink': { mutating: true, destructive: true },
  'ticket update': { mutating: true, destructive: false },
  'epic add-board': { mutating: true, destructive: false },
  'epic add-ticket': { mutating: true, destructive: false },
  'epic archive': { mutating: true, destructive: false },
  'epic create': { mutating: true, destructive: false },
  'epic delete': { mutating: true, destructive: true },
  'epic list': { mutating: false, destructive: false },
  'epic remove-board': { mutating: true, destructive: true },
  'epic remove-ticket': { mutating: true, destructive: true },
  'epic show': { mutating: false, destructive: false },
  'epic unarchive': { mutating: true, destructive: false },
  'epic update': { mutating: true, destructive: false },
};

/** Rebuild a Commander tree with the real command paths, no CLI import needed. */
function syntheticProgram(): Command {
  const root = new Command('fleex');
  for (const { commandPath } of LEAVES) {
    let parent = root;
    for (const segment of commandPath) {
      parent = parent.commands.find((c) => c.name() === segment) ?? parent.command(segment);
    }
  }
  return root;
}

describe('CLI leaf discovery', () => {
  it('registers each command under its own directory name', () => {
    // `loadAndRegister` attaches a command with `def.name`, not the folder name.
    // If the two diverged, every path in EXPECTED would silently address a
    // command that does not exist, and the whole suite would assert nothing.
    const mismatches = ALL_COMMAND_DIRS.filter(({ dir }) => {
      const source = readFileSync(path.join(dir, 'index.ts'), 'utf8');
      const declared = /^\s*name: '([^']+)',/m.exec(source)?.[1];
      return declared !== path.basename(dir);
    }).map(({ dir }) => path.relative(COMMANDS_DIR, dir));
    expect(mismatches).toEqual([]);
  });

  it('has a declared classification for every leaf, and no stale entry', () => {
    // This is the anti-regression guard: adding a CLI command breaks the suite
    // until somebody states, in writing, whether it mutates state.
    const discovered = LEAVES.map((l) => l.commandPath.join(' ')).sort();
    expect(discovered).toEqual(Object.keys(EXPECTED).sort());
  });
});

describe('leaf classification', () => {
  it.each(Object.entries(EXPECTED))('%s', (commandPath, expected) => {
    const leaf = commandPath.split(' ').at(-1)!;
    expect(isMutatingLeaf(leaf)).toBe(expected.mutating);
    expect(isDestructiveLeaf(leaf)).toBe(expected.destructive);
  });

  it('fails closed on an unknown leaf', () => {
    // The whole point of the inversion: a command nobody classified is gated.
    expect(isMutatingLeaf('frobnicate')).toBe(true);
    expect(isMutatingLeaf('list')).toBe(false);
  });

  it('finds the verb at either end of a hyphenated leaf', () => {
    expect(leafSegments('comment-delete')).toEqual(['comment', 'delete']);
    expect(isDestructiveLeaf('comment-delete')).toBe(true); // verb last
    expect(isDestructiveLeaf('remove-board')).toBe(true); // verb first
    expect(isDestructiveLeaf('add-board')).toBe(false);
  });
});

describe('MCP annotations for the real command surface', () => {
  const tools = generateTools(syntheticProgram()).map(toMcpTool);
  const byPath = new Map(tools.map((t) => [t.annotations.title.replace(/^fleex /, ''), t]));

  it('exposes exactly one tool per leaf', () => {
    expect([...byPath.keys()].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('never annotates a mutating leaf as read-only', () => {
    const readOnlyButMutating = Object.entries(EXPECTED)
      .filter(([, e]) => e.mutating)
      .filter(([p]) => byPath.get(p)!.annotations.readOnlyHint)
      .map(([p]) => p);
    expect(readOnlyButMutating).toEqual([]);
  });

  it('flags every destructive leaf with destructiveHint', () => {
    const flagged = tools.filter((t) => t.annotations.destructiveHint)
      .map((t) => t.annotations.title.replace(/^fleex /, '')).sort();
    const expectedDestructive = Object.entries(EXPECTED)
      .filter(([, e]) => e.destructive).map(([p]) => p).sort();
    expect(flagged).toEqual(expectedDestructive);
  });

  it('leaves read commands ungated', () => {
    for (const [commandPath, e] of Object.entries(EXPECTED)) {
      if (e.mutating) continue;
      const annotations = byPath.get(commandPath)!.annotations;
      expect(annotations.readOnlyHint, commandPath).toBe(true);
      expect(annotations.destructiveHint, commandPath).toBe(false);
    }
  });
});
