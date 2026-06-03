import type { Command } from 'commander';
import chalk from 'chalk';
import type {
  AgentPersona,
  Skill,
  Panel,
  WorkflowTemplate,
  MarketplacePrimitiveContent,
  MarketplacePrimitiveEntry,
  MarketplacePersona,
  MarketplaceSkill,
  MarketplacePanel,
  MarketplaceWorkflow,
  PrimitiveKind,
} from '@fleex/shared';
import { MARKETPLACE_SCHEMA_VERSION } from '@fleex/shared';
import type { CommandDef } from '../../core/types.ts';
import { apiBase, apiGet, apiCall } from '../../core/api.ts';
import { c, info, ok, warn, die, padEndVisible } from '../../core/colors.ts';
import {
  canPrompt,
  closePrompts,
  promptMultiSelect,
  promptSelectOne,
  promptText,
  promptYesNo,
} from '../../core/prompt.ts';
import {
  readRegistry,
  getMarketplace,
  loadManifest,
  loadPrimitiveContent,
  type RegisteredMarketplace,
} from '../../core/registry.ts';
import {
  toMarketplacePersona,
  toMarketplaceSkill,
  toMarketplacePanel,
  toMarketplaceWorkflow,
} from '../../core/marketplace.ts';
import { contentEquals, renderDiff } from '../../core/marketplace-diff.ts';
import { personaBody, skillBody, panelBody, workflowBody } from '../../core/marketplace-install.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const ORDER: PrimitiveKind[] = ['persona', 'skill', 'panel', 'workflow'];

const key = (kind: PrimitiveKind, slug: string) => `${kind}:${slug}`;

type Status = 'absent' | 'identical' | 'different' | 'present';

interface Row {
  kind: PrimitiveKind;
  slug: string;
  source: 'selected' | 'dependency';
  inManifest: boolean;
  status: Status;
  content?: MarketplacePrimitiveContent; // marketplace content (if in manifest)
  localContent?: MarketplacePrimitiveContent; // converted local (if present)
  localId?: string; // local DTO id (if present, for replace)
}

interface LocalState {
  idByKey: Map<string, string>;
  contentByKey: Map<string, MarketplacePrimitiveContent>;
  personaSlugToId: Map<string, string>;
}

async function fetchLocal(base: string): Promise<LocalState> {
  const [personas, skills, panels, workflows] = await Promise.all([
    apiGet<AgentPersona[]>(`${base}/api/personas`),
    apiGet<Skill[]>(`${base}/api/skills`),
    apiGet<Panel[]>(`${base}/api/panels`),
    apiGet<WorkflowTemplate[]>(`${base}/api/workflows/templates`),
  ]);
  const idToName = new Map(personas.map((p) => [p.id, p.name]));
  const idByKey = new Map<string, string>();
  const contentByKey = new Map<string, MarketplacePrimitiveContent>();
  const tryAdd = (kind: PrimitiveKind, slug: string, id: string, build: () => MarketplacePrimitiveContent) => {
    idByKey.set(key(kind, slug), id);
    try {
      contentByKey.set(key(kind, slug), build());
    } catch {
      // local refs unresolved — leave uncomparable (treated as "different")
    }
  };
  for (const p of personas) tryAdd('persona', p.name, p.id, () => toMarketplacePersona(p, { includeMemory: false }));
  for (const s of skills) tryAdd('skill', s.commandName, s.id, () => toMarketplaceSkill(s, idToName));
  for (const p of panels) tryAdd('panel', p.name, p.id, () => toMarketplacePanel(p, idToName));
  for (const w of workflows) tryAdd('workflow', w.slug, w.id, () => toMarketplaceWorkflow(w));
  return { idByKey, contentByKey, personaSlugToId: new Map(personas.map((p) => [p.name, p.id])) };
}

function statusGlyph(status: Status): string {
  switch (status) {
    case 'absent':
      return c.green('+');
    case 'different':
      return c.yellow('≠');
    default:
      return c.dim('✓');
  }
}

function statusNote(row: Row): string {
  if (!row.inManifest) {
    return row.status === 'absent'
      ? c.red('absent — not in this marketplace, dependents may fail')
      : c.dim('satisfied locally');
  }
  switch (row.status) {
    case 'absent':
      return c.green('absent → will install');
    case 'identical':
      return c.dim('identical → skip');
    case 'different':
      return c.yellow('differs → decide');
    default:
      return '';
  }
}

function printReport(rows: Row[], marketplaceName: string): void {
  info(`Plan (from marketplace ${c.cyan(marketplaceName)}):`);
  const groups: Array<[string, Row[]]> = [
    ['selected', rows.filter((r) => r.source === 'selected')],
    ['dependencies', rows.filter((r) => r.source === 'dependency' && r.inManifest)],
    ['external refs', rows.filter((r) => r.source === 'dependency' && !r.inManifest)],
  ];
  for (const [label, group] of groups) {
    if (group.length === 0) continue;
    process.stdout.write(`\n  ${c.bold(label)}:\n`);
    for (const r of group) {
      const head = `${statusGlyph(r.status)} ${padEndVisible(r.kind, 9)} ${padEndVisible(r.slug, 24)}`;
      process.stdout.write(`    ${head} ${statusNote(r)}\n`);
    }
  }
  process.stdout.write('\n');
}

interface ImportOptions {
  marketplace?: string;
  primitive?: string[];
  all?: boolean;
  onConflict?: string; // skip | replace | ask
  yes?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'import',
  description: 'Install primitives from a registered marketplace into this instance',
  setup(cmd: Command) {
    cmd.option('--marketplace <name>', 'marketplace to install from');
    cmd.option('--primitive <kind:slug...>', 'primitives to install (e.g. panel:chapeaux persona:jarvis)');
    cmd.option('--all', 'install every primitive in the marketplace');
    cmd.option('--on-conflict <mode>', 'when a primitive exists locally and differs: skip | replace | ask', 'ask');
    cmd.option('-y, --yes', 'skip the final confirmation');
  },
  extraHelp: `\n${SECTION('How it works:')}
  Lists a marketplace's primitives, lets you pick some, then shows every
  dependency and its local state: ${c.green('+')} absent · ${c.yellow('≠')} differs · ${c.dim('✓')} identical.
  You decide what to install/replace. Nothing about the source is persisted —
  installing is a plain copy.

${SECTION('Examples:')}
  ${DIM('$')} fleex import                                   ${DIM('# fully interactive')}
  ${DIM('$')} fleex import --marketplace oliviermadre-fleex-marketplace --all
  ${DIM('$')} fleex import --primitive panel:les-chapeaux-de-bono
  ${DIM('$')} fleex import --all --on-conflict replace -y
`,
  async action(opts: ImportOptions) {
    try {
      const base = apiBase();

      // ── 1. pick a marketplace ──
      const registry = readRegistry();
      let mp: RegisteredMarketplace | undefined;
      if (opts.marketplace) {
        mp = getMarketplace(opts.marketplace);
        if (!mp) die(`Marketplace "${opts.marketplace}" is not registered.`);
      } else if (registry.length === 0) {
        die('No marketplaces registered. Add one with: fleex marketplace add <git-url>');
      } else if (registry.length === 1) {
        mp = registry[0];
      } else if (canPrompt()) {
        mp = await promptSelectOne('Marketplaces', registry, (m) => `${m.name} ${c.dim(m.url)}`);
        if (!mp) die('No marketplace selected.');
      } else {
        die('Multiple marketplaces registered — specify --marketplace <name>.');
      }

      const manifest = loadManifest(mp!.path);
      if (manifest.schemaVersion > MARKETPLACE_SCHEMA_VERSION) {
        warn(`marketplace schemaVersion ${manifest.schemaVersion} > supported ${MARKETPLACE_SCHEMA_VERSION}; consider updating fleex.`);
      }
      const entries = manifest.primitives;
      if (entries.length === 0) {
        info('This marketplace is empty.');
        return;
      }

      // ── 2. select primitives ──
      const entryByKey = new Map(entries.map((e) => [key(e.kind, e.slug), e]));
      let selected: MarketplacePrimitiveEntry[];
      if (opts.all) {
        selected = entries;
      } else if (opts.primitive?.length) {
        selected = [];
        for (const token of opts.primitive) {
          const e = entryByKey.get(token) ?? entries.find((x) => x.slug === token);
          if (e) selected.push(e);
          else warn(`no primitive matches "${token}" — skipped`);
        }
      } else if (canPrompt()) {
        selected = await promptMultiSelect('Primitives', entries, (e) =>
          `${padEndVisible(e.kind, 9)} ${padEndVisible(e.slug, 24)} ${c.dim(e.displayName)}`,
        );
      } else {
        die('Specify --all or --primitive <kind:slug...>.');
      }
      if (selected.length === 0) {
        info('Nothing selected.');
        return;
      }

      // ── 3. transitive dependency closure ──
      const selectedKeys = new Set(selected.map((e) => key(e.kind, e.slug)));
      const closure = new Map<string, MarketplacePrimitiveEntry | null>();
      const visit = (kind: PrimitiveKind, slug: string) => {
        const k = key(kind, slug);
        if (closure.has(k)) return;
        const entry = entryByKey.get(k) ?? null;
        closure.set(k, entry);
        if (entry) for (const dep of entry.dependencies) visit(dep.kind, dep.slug);
      };
      for (const e of selected) visit(e.kind, e.slug);

      // ── 4. classify against local state ──
      const local = await fetchLocal(base);
      const rows: Row[] = [];
      for (const [k, entry] of closure) {
        const [kind, slug] = k.split(/:(.*)/s) as [PrimitiveKind, string];
        const source = selectedKeys.has(k) ? 'selected' : 'dependency';
        const localId = local.idByKey.get(k);
        const localContent = local.contentByKey.get(k);
        if (!entry) {
          rows.push({ kind, slug, source, inManifest: false, status: localId ? 'present' : 'absent' });
          continue;
        }
        const content = loadPrimitiveContent(mp!.path, entry);
        let status: Status;
        if (!localId) status = 'absent';
        else if (localContent && contentEquals(localContent, content)) status = 'identical';
        else status = 'different';
        rows.push({ kind, slug, source, inManifest: true, status, content, localContent, localId });
      }
      rows.sort((a, z) => ORDER.indexOf(a.kind) - ORDER.indexOf(z.kind) || a.slug.localeCompare(z.slug));

      // ── 5. report (transparent: every dep, every state) ──
      printReport(rows, mp!.name);

      // ── 6. decide actions ──
      const policy = (opts.onConflict ?? 'ask').toLowerCase();
      const interactive = canPrompt() && !opts.yes;
      type Action = { kind: PrimitiveKind; slug: string; type: 'create' | 'replace'; content: MarketplacePrimitiveContent; localId?: string };
      const actions: Action[] = [];

      for (const r of rows) {
        if (!r.inManifest || !r.content) continue;
        if (r.status === 'identical') continue;
        if (r.status === 'absent') {
          actions.push({ kind: r.kind, slug: r.slug, type: 'create', content: r.content });
          continue;
        }
        // status === 'different'
        let decision: 'replace' | 'skip';
        if (policy === 'replace') decision = 'replace';
        else if (policy === 'skip') decision = 'skip';
        else if (interactive) {
          decision = 'skip';
          for (;;) {
            const ans = (await promptText(`${c.yellow('≠')} ${r.kind} ${c.bold(r.slug)} differs — [d]iff / [r]eplace / [s]kip`, 's')).toLowerCase();
            if (ans === 'd') {
              process.stdout.write(`\n${renderDiff(r.localContent ?? ({} as MarketplacePrimitiveContent), r.content)}\n\n`);
              continue;
            }
            if (ans === 'r') decision = 'replace';
            break;
          }
        } else decision = 'skip';
        if (decision === 'replace') {
          actions.push({ kind: r.kind, slug: r.slug, type: 'replace', content: r.content, localId: r.localId });
        }
      }

      // External refs that can't be satisfied → warn (dependents may fail).
      for (const r of rows) {
        if (!r.inManifest && r.status === 'absent') {
          warn(`dependency ${r.kind} "${r.slug}" is absent and not in this marketplace — install it separately or dependents may not work.`);
        }
      }

      if (actions.length === 0) {
        info('Nothing to install (all selected primitives already present and identical, or skipped).');
        return;
      }

      // ── 7. confirm ──
      const creates = actions.filter((a) => a.type === 'create').length;
      const replaces = actions.filter((a) => a.type === 'replace').length;
      info(`About to ${c.green(`install ${creates}`)} and ${c.yellow(`replace ${replaces}`)} primitive(s).`);
      if (interactive && !(await promptYesNo('Proceed?', true))) {
        info('Aborted.');
        return;
      }

      // ── 8. execute in dependency order ──
      let personaSlugToId = local.personaSlugToId;
      let installed = 0;
      let failed = 0;
      for (const kind of ORDER) {
        for (const a of actions.filter((x) => x.kind === kind)) {
          try {
            if (kind === 'persona') {
              const body = personaBody(a.content as MarketplacePersona);
              if (a.type === 'create') await apiCall('POST', `${base}/api/personas`, body);
              else await apiCall('PATCH', `${base}/api/personas/${a.localId}`, body);
            } else if (kind === 'skill') {
              const sc = a.content as MarketplaceSkill;
              const pid = personaSlugToId.get(sc.persona);
              if (!pid) throw new Error(`persona "${sc.persona}" not found locally`);
              const body = skillBody(sc, pid);
              if (a.type === 'create') await apiCall('POST', `${base}/api/skills`, body);
              else await apiCall('PATCH', `${base}/api/skills/${a.localId}`, body);
            } else if (kind === 'panel') {
              const pc = a.content as MarketplacePanel;
              if (pc.orchestratorPersona) {
                warn(`panel "${pc.name}": orchestrator persona "${pc.orchestratorPersona}" can't be set via the API — left unset.`);
              }
              const resolve = (slug: string) => {
                const id = personaSlugToId.get(slug);
                if (!id) throw new Error(`persona "${slug}" not found locally`);
                return id;
              };
              const body = panelBody(pc, resolve);
              if (a.type === 'create') await apiCall('POST', `${base}/api/panels`, body);
              else await apiCall('PATCH', `${base}/api/panels/${a.localId}`, body);
            } else {
              const body = workflowBody(a.content as MarketplaceWorkflow);
              if (a.type === 'create') await apiCall('POST', `${base}/api/workflows/templates`, body);
              else await apiCall('PUT', `${base}/api/workflows/templates/${a.localId}`, body);
            }
            installed++;
            ok(`${a.type === 'create' ? 'installed' : 'replaced'} ${kind} ${c.cyan(a.slug)}`);
          } catch (e) {
            failed++;
            warn(`failed ${kind} "${a.slug}": ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (kind === 'persona') {
          // Refresh so just-created personas resolve for skills/panels.
          const personas = await apiGet<AgentPersona[]>(`${base}/api/personas`);
          personaSlugToId = new Map(personas.map((p) => [p.name, p.id]));
        }
      }

      info(`Done — ${installed} applied${failed ? `, ${c.red(`${failed} failed`)}` : ''}.`);
    } finally {
      closePrompts();
    }
  },
};

export default def;
