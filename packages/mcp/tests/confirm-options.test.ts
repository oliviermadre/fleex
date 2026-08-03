/**
 * `--force` does not always mean "skip the confirmation prompt": on
 * `marketplace add` it means "re-clone if it already exists". So the generator
 * identifies a confirmation-skip flag by name AND description, rather than by
 * name alone — misreading an operation modifier as a confirmation flag would
 * strip it from the schema and then re-inject it on every approved call.
 *
 * That leaves exactly one way to fail open: a genuine confirmation flag whose
 * description never says "confirm" would stay in the model-facing schema, and
 * the model could wave away the CLI's own guard on its own initiative. This
 * suite closes it by asserting across the WHOLE CLI — any group can be exposed
 * through FLEEX_MCP_INCLUDE, not just ticket/epic — that every `--force`/`--yes`
 * either states its intent or is a declared exception.
 *
 * Scanned from source rather than from the command tree: `buildProgram()` uses
 * `Bun.Glob`, which does not exist under `vitest run` (node).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMANDS_DIR = fileURLToPath(new URL('../../cli/src/commands', import.meta.url));

function commandFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(dir, entry.name);
    if (existsSync(path.join(sub, 'index.ts'))) out.push(path.join(sub, 'index.ts'));
    commandFiles(sub, out);
  }
  return out;
}

interface Decl { file: string; flags: string; description: string }

/** Matches `cmd.option('-f, --force', 'Skip confirmation')`. */
const OPTION_RE = /\.option\(\s*'([^']+)'\s*,\s*'([^']*)'/g;

function forceOrYesDeclarations(): Decl[] {
  const found: Decl[] = [];
  for (const file of commandFiles(COMMANDS_DIR)) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(OPTION_RE)) {
      if (!/--(force|yes)\b/.test(m[1]!)) continue;
      found.push({ file: path.relative(COMMANDS_DIR, file), flags: m[1]!, description: m[2]! });
    }
  }
  return found;
}

/**
 * Options named `--force`/`--yes` that are NOT confirmation gates. Each entry is
 * a deliberate statement: the generator must leave it in the model-facing schema
 * and must never auto-inject it after approval.
 */
const NOT_A_CONFIRMATION: Record<string, string> = {
  'marketplace/add/index.ts': 're-clone if a marketplace with this name already exists',
};

describe('CLI --force/--yes declarations', () => {
  const declarations = forceOrYesDeclarations();

  it('actually finds the declarations (guards the scanner itself)', () => {
    // Without this, a broken regex would make every assertion below vacuous.
    expect(declarations.length).toBeGreaterThan(10);
  });

  it('states its intent, so the generator can tell a gate from a modifier', () => {
    const silent = declarations
      .filter((d) => !/confirm/i.test(d.description))
      .filter((d) => NOT_A_CONFIRMATION[d.file] !== d.description)
      .map((d) => `${d.file}: ${d.flags} — "${d.description}"`);
    // A new confirmation flag phrased without the word "confirm" lands here.
    // Either reword the description, or declare it in NOT_A_CONFIRMATION above.
    expect(silent).toEqual([]);
  });

  it('keeps the known operation modifiers out of the confirmation set', () => {
    for (const [file, description] of Object.entries(NOT_A_CONFIRMATION)) {
      const decl = declarations.find((d) => d.file === file);
      expect(decl, `${file} no longer declares --force/--yes`).toBeDefined();
      expect(decl!.description, file).toBe(description);
      expect(/confirm/i.test(decl!.description), file).toBe(false);
    }
  });
});
