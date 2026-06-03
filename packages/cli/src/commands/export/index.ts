import type { Command } from 'commander';
import chalk from 'chalk';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import type {
  AgentPersona,
  Skill,
  Panel,
  WorkflowTemplate,
  MarketplaceManifest,
  MarketplacePrimitiveContent,
  MarketplacePrimitiveEntry,
  PrimitiveKind,
  PrimitiveRef,
} from '@fleex/shared';
import { MARKETPLACE_SCHEMA_VERSION } from '@fleex/shared';
import type { CommandDef } from '../../core/types.ts';
import { apiBase, apiGet } from '../../core/api.ts';
import { c, info, ok, warn, die } from '../../core/colors.ts';
import { canPrompt, closePrompts, promptMultiSelect, promptText } from '../../core/prompt.ts';
import {
  deriveSkillDeps,
  derivePanelDeps,
  deriveWorkflowDeps,
  filePathFor,
  toMarketplacePersona,
  toMarketplacePanel,
  toMarketplaceSkill,
  toMarketplaceWorkflow,
} from '../../core/marketplace.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

interface ExportOptions {
  out?: string;
  name?: string;
  all?: boolean;
  persona?: string[];
  skill?: string[];
  panel?: string[];
  workflow?: string[];
  includeMemory?: boolean;
}

interface Built {
  kind: PrimitiveKind;
  slug: string;
  displayName: string;
  path: string;
  dependencies: PrimitiveRef[];
  content: MarketplacePrimitiveContent;
}

/** Filter items to those whose slug is in `wanted`, warning about misses. */
function pickByFlag<T>(items: readonly T[], slugOf: (t: T) => string, wanted: string[]): T[] {
  const set = new Set(wanted);
  const found = items.filter((it) => set.has(slugOf(it)));
  for (const w of wanted) {
    if (!items.some((it) => slugOf(it) === w)) warn(`no primitive matches "${w}" — skipped`);
  }
  return found;
}

async function loadExisting(manifestPath: string): Promise<MarketplaceManifest | null> {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8')) as MarketplaceManifest;
  } catch {
    return null;
  }
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'export',
  description: 'Export agentic primitives (personas, skills, panels, workflows) into a marketplace repo',
  setup(cmd: Command) {
    cmd.option('--out <dir>', 'target marketplace directory (its git working copy)');
    cmd.option('--name <name>', 'marketplace name written to marketplace.json');
    cmd.option('--all', 'export every primitive');
    cmd.option('--persona <slugs...>', 'persona names to export');
    cmd.option('--skill <commandNames...>', 'skill command names to export');
    cmd.option('--panel <slugs...>', 'panel names to export');
    cmd.option('--workflow <slugs...>', 'workflow slugs to export');
    cmd.option('--include-memory', 'include persona memoryMd (personal state, excluded by default)');
  },
  extraHelp: `\n${SECTION('What it does:')}
  Writes selected primitives as portable JSON (slug-based, no UUIDs) plus a
  marketplace.json manifest into the target directory. Persona memoryMd is
  excluded by default. The directory should be a git repo you control — review,
  commit, and push it yourself.

${SECTION('Examples:')}
  ${DIM('$')} fleex export                                   ${DIM('# interactive selection')}
  ${DIM('$')} fleex export --all --out ~/code/fleex-marketplace
  ${DIM('$')} fleex export --panel les-chapeaux-de-bono --out ./mp
  ${DIM('$')} fleex export --persona jarvis --include-memory --out ./mp
`,
  async action(opts: ExportOptions) {
    try {
      const base = apiBase();
      const [personas, skills, panels, workflows] = await Promise.all([
        apiGet<AgentPersona[]>(`${base}/api/personas`),
        apiGet<Skill[]>(`${base}/api/skills`),
        apiGet<Panel[]>(`${base}/api/panels`),
        apiGet<WorkflowTemplate[]>(`${base}/api/workflows/templates`),
      ]);
      const idToName = new Map(personas.map((p) => [p.id, p.name]));
      const includeMemory = Boolean(opts.includeMemory);

      // ── Selection: flags, or interactive numbered multi-select ──
      const useFlags =
        opts.all || opts.persona || opts.skill || opts.panel || opts.workflow;
      let selPersonas: AgentPersona[];
      let selSkills: Skill[];
      let selPanels: Panel[];
      let selWorkflows: WorkflowTemplate[];

      if (useFlags) {
        selPersonas = opts.all ? personas : pickByFlag(personas, (p) => p.name, opts.persona ?? []);
        selSkills = opts.all ? skills : pickByFlag(skills, (s) => s.commandName, opts.skill ?? []);
        selPanels = opts.all ? panels : pickByFlag(panels, (p) => p.name, opts.panel ?? []);
        selWorkflows = opts.all ? workflows : pickByFlag(workflows, (w) => w.slug, opts.workflow ?? []);
      } else {
        if (!canPrompt()) {
          die('No selection given and no interactive terminal. Use --all or --persona/--skill/--panel/--workflow.');
        }
        selPersonas = await promptMultiSelect('Personas', personas, (p) => `${p.name} ${c.dim(p.displayName)}`);
        selSkills = await promptMultiSelect('Skills', skills, (s) => `${s.commandName} ${c.dim(s.displayName)}`);
        selPanels = await promptMultiSelect('Panels', panels, (p) => `${p.name} ${c.dim(p.displayName)}`);
        selWorkflows = await promptMultiSelect('Workflows', workflows, (w) => `${w.slug} ${c.dim(w.name)}`);
      }

      // ── Convert + derive dependencies (per-item, skip on dangling refs) ──
      const built: Built[] = [];
      const skip = (kind: string, slug: string, e: unknown) =>
        warn(`skipped ${kind} "${slug}": ${e instanceof Error ? e.message : String(e)}`);

      for (const p of selPersonas) {
        const content = toMarketplacePersona(p, { includeMemory });
        built.push({ kind: 'persona', slug: p.name, displayName: p.displayName, path: filePathFor('persona', p.name), dependencies: [], content });
      }
      for (const s of selSkills) {
        try {
          const content = toMarketplaceSkill(s, idToName);
          built.push({ kind: 'skill', slug: s.commandName, displayName: s.displayName, path: filePathFor('skill', s.commandName), dependencies: deriveSkillDeps(content), content });
        } catch (e) {
          skip('skill', s.commandName, e);
        }
      }
      for (const p of selPanels) {
        try {
          const content = toMarketplacePanel(p, idToName);
          built.push({ kind: 'panel', slug: p.name, displayName: p.displayName, path: filePathFor('panel', p.name), dependencies: derivePanelDeps(content), content });
        } catch (e) {
          skip('panel', p.name, e);
        }
      }
      for (const w of selWorkflows) {
        const content = toMarketplaceWorkflow(w);
        built.push({ kind: 'workflow', slug: w.slug, displayName: w.name, path: filePathFor('workflow', w.slug), dependencies: deriveWorkflowDeps(content), content });
      }

      if (built.length === 0) {
        info('Nothing selected — nothing exported.');
        return;
      }

      // ── Resolve destination ──
      let outArg = opts.out;
      if (!outArg) {
        if (!canPrompt()) die('Missing --out <dir>.');
        outArg = await promptText('Marketplace directory', process.cwd());
      }
      const outDir = resolve(outArg);
      const manifestPath = join(outDir, 'marketplace.json');
      const existing = await loadExisting(manifestPath);
      const name = opts.name || existing?.name || basename(outDir);

      // ── Merge manifest entries (upsert by kind:slug) ──
      const entryMap = new Map<string, MarketplacePrimitiveEntry>();
      for (const e of existing?.primitives ?? []) entryMap.set(`${e.kind}:${e.slug}`, e);
      for (const b of built) {
        entryMap.set(`${b.kind}:${b.slug}`, {
          kind: b.kind,
          slug: b.slug,
          displayName: b.displayName,
          path: b.path,
          dependencies: b.dependencies,
        });
      }
      const primitives = [...entryMap.values()].sort(
        (a, z) => a.kind.localeCompare(z.kind) || a.slug.localeCompare(z.slug),
      );

      // ── Write content files + manifest ──
      for (const b of built) {
        const file = join(outDir, b.path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(b.content, null, 2) + '\n');
      }
      const manifest: MarketplaceManifest = {
        schemaVersion: MARKETPLACE_SCHEMA_VERSION,
        name,
        ...(existing?.description ? { description: existing.description } : {}),
        primitives,
      };
      await mkdir(outDir, { recursive: true });
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

      // ── Summary ──
      const byKind = built.reduce<Record<string, number>>((acc, b) => {
        acc[b.kind] = (acc[b.kind] ?? 0) + 1;
        return acc;
      }, {});
      ok(`Exported ${built.length} primitive(s) to ${c.cyan(outDir)}`);
      info(
        Object.entries(byKind)
          .map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`)
          .join(' · '),
      );
      if (!includeMemory && byKind.persona) {
        info(c.dim('persona memoryMd was excluded (use --include-memory to keep it)'));
      }
      info(c.dim('Review the changes, then commit & push the marketplace repo yourself.'));
    } finally {
      closePrompts();
    }
  },
};

export default def;
