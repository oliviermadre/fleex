import type { Command } from 'commander';
import chalk from 'chalk';
import { unlink, mkdir, writeFile, readdir, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type {
  MarketplaceManifest,
  MarketplacePrimitiveEntry,
  PrimitiveKind,
  PrimitiveRef,
} from '@fleex/shared';
import { MARKETPLACE_SCHEMA_VERSION } from '@fleex/shared';
import type { CommandDef } from '../../core/types.ts';
import { c, info, ok, warn, die } from '../../core/colors.ts';
import { canPrompt, closePrompts, promptYesNo, promptMultiSelect, promptText } from '../../core/prompt.ts';
import { loadManifest } from '../../core/registry.ts';
import { computeRemovalClosure, refKey, DIR_BY_KIND } from '../../core/marketplace.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const KINDS: readonly PrimitiveKind[] = ['persona', 'skill', 'panel', 'workflow'];

interface UnexportOptions {
  out?: string;
  primitive?: string[];
  cascade?: boolean;
  yes?: boolean;
}

/** Parse a "kind:slug" token into a PrimitiveRef, or null if malformed. */
function parseRef(token: string): PrimitiveRef | null {
  const idx = token.indexOf(':');
  if (idx <= 0) return null;
  const kind = token.slice(0, idx) as PrimitiveKind;
  const slug = token.slice(idx + 1);
  if (!KINDS.includes(kind) || !slug) return null;
  return { kind, slug };
}

const def: CommandDef = {
  name: 'unexport',
  description: 'Remove primitives from a marketplace repo, keeping the manifest referentially consistent',
  setup(cmd: Command) {
    cmd.option('--out <dir>', 'target marketplace directory (its git working copy)');
    cmd.option('--primitive <kind:slug...>', 'primitives to remove (e.g. persona:jarvis skill:search)');
    cmd.option('--cascade', 'also remove every primitive that depends on the targets');
    cmd.option('-y, --yes', 'skip confirmation prompts');
  },
  extraHelp: `\n${SECTION('What it does:')}
  The inverse of ${DIM('fleex export')}. Removes the selected primitives — and any
  primitive that depends on them — from a marketplace working copy, deleting both
  the JSON files and their manifest entries. The result is always consistent: it
  never leaves a dangling dependency behind. Edits a directory you control; review,
  commit, and push it yourself.

${SECTION('Examples:')}
  ${DIM('$')} fleex unexport --out ./mp                          ${DIM('# interactive selection')}
  ${DIM('$')} fleex unexport --primitive skill:search --out ./mp
  ${DIM('$')} fleex unexport --primitive persona:jarvis --cascade -y --out ./mp
`,
  async action(opts: UnexportOptions) {
    try {
      // ── Resolve destination + load a valid manifest ──
      let outArg = opts.out;
      if (!outArg) {
        if (!canPrompt()) die('Missing --out <dir>.');
        outArg = await promptText('Marketplace directory', process.cwd());
      }
      const outDir = resolve(outArg);
      const manifestPath = join(outDir, 'marketplace.json');
      let manifest: MarketplaceManifest;
      try {
        manifest = loadManifest(outDir);
      } catch (e) {
        die(`Not a marketplace at ${c.cyan(outDir)}: ${e instanceof Error ? e.message : String(e)}`);
      }

      // ── Resolve targets: --primitive flags, or interactive multi-select ──
      let targets: PrimitiveRef[];
      if (opts.primitive && opts.primitive.length > 0) {
        targets = [];
        for (const token of opts.primitive) {
          const ref = parseRef(token);
          if (!ref) {
            warn(`ignoring "${token}" — expected kind:slug (kind one of ${KINDS.join(', ')})`);
            continue;
          }
          if (!manifest.primitives.some((p) => p.kind === ref.kind && p.slug === ref.slug)) {
            warn(`"${refKey(ref)}" is not in this marketplace — skipped`);
            continue;
          }
          targets.push(ref);
        }
      } else {
        if (!canPrompt()) {
          die('No selection given and no interactive terminal. Use --primitive <kind:slug...>.');
        }
        const picked = await promptMultiSelect(
          'Primitives to remove',
          manifest.primitives,
          (p) => `${p.kind}:${p.slug} ${c.dim(p.displayName)}`,
        );
        targets = picked.map((p) => ({ kind: p.kind, slug: p.slug }));
      }

      if (targets.length === 0) {
        info('Nothing to remove.');
        return;
      }

      // ── Compute removal closure (targets + transitive dependents) ──
      const { toRemove, dependents } = computeRemovalClosure(manifest.primitives, targets);

      const fmt = (e: MarketplacePrimitiveEntry) => `${c.cyan(`${e.kind}:${e.slug}`)} ${c.dim(e.displayName)}`;

      if (dependents.length > 0) {
        warn(`${dependents.length} other primitive(s) depend on what you're removing:`);
        for (const e of dependents) info(`  ${fmt(e)}`);
        if (opts.cascade) {
          info('Removing them too (--cascade).');
        } else if (canPrompt()) {
          const go = await promptYesNo('Remove these dependents too?', false);
          if (!go) {
            info('Cancelled — nothing was removed.');
            return;
          }
        } else {
          die('Refusing to leave dangling dependencies. Re-run with --cascade to remove the dependents.');
        }
      }

      // ── Final confirmation ──
      if (!opts.yes) {
        if (canPrompt()) {
          info(`Will remove ${toRemove.length} primitive(s):`);
          for (const e of toRemove) info(`  ${fmt(e)}`);
          const go = await promptYesNo(`Remove ${toRemove.length} primitive(s)?`, false);
          if (!go) {
            info('Cancelled — nothing was removed.');
            return;
          }
        } else {
          die('Refusing to delete without -y in a non-interactive terminal.');
        }
      }

      // ── Delete content files ──
      const removeKeys = new Set(toRemove.map(refKey));
      for (const e of toRemove) {
        const file = join(outDir, e.path);
        try {
          await unlink(file);
        } catch {
          warn(`file already gone: ${e.path}`);
        }
      }

      // ── Rewrite manifest with the survivors (same shape/sort as export) ──
      const primitives = manifest.primitives
        .filter((e) => !removeKeys.has(refKey(e)))
        .sort((a, z) => a.kind.localeCompare(z.kind) || a.slug.localeCompare(z.slug));
      const next: MarketplaceManifest = {
        schemaVersion: MARKETPLACE_SCHEMA_VERSION,
        name: manifest.name,
        ...(manifest.description ? { description: manifest.description } : {}),
        primitives,
      };
      await mkdir(outDir, { recursive: true });
      await writeFile(manifestPath, JSON.stringify(next, null, 2) + '\n');

      // ── Drop kind subdirectories that are now empty ──
      for (const kind of KINDS) {
        const dir = join(outDir, DIR_BY_KIND[kind]);
        try {
          if ((await readdir(dir)).length === 0) await rmdir(dir);
        } catch {
          /* dir missing or non-empty — leave it */
        }
      }

      ok(`Removed ${toRemove.length} primitive(s) from ${c.cyan(outDir)}`);
      info(c.dim('Review the changes, then commit & push the marketplace repo yourself.'));
    } finally {
      closePrompts();
    }
  },
};

export default def;
