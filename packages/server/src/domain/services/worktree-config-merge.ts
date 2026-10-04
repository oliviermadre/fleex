import {
  WORKTREE_DISCOVERY_SOURCES,
  worktreeClickByState,
  type WorktreeActionDef,
  type WorktreeActionItem,
  type WorktreeClickChoice,
  type WorktreeConfig,
  type WorktreeConfigLayer,
  type WorktreeDiscoverySource,
  type WorktreeServerConfig,
  type WorktreeServerState,
} from '@fleex/shared';
import type { DetectedItem } from './worktree-discovery.js';

/**
 * Merges the four config layers of a worktree into its menu.
 *
 * Rules (PRD §4.1): a same `id` in a stronger layer masks the weaker one;
 * personal and shared `pins` add up; the personal layer may hide a shared
 * action (`hidden: true`); declared actions may reference a detected item by
 * id (`cmd: "npm:dev"`) and then run that item's command.
 */

export interface MergeInput {
  personal?: WorktreeConfig;
  shared?: WorktreeConfig;
  /** `.claude/launch.json` configurations. */
  launch: DetectedItem[];
  /** package.json / Makefile / composer.json. */
  detected: DetectedItem[];
}

export interface MergedWorktree {
  items: WorktreeActionItem[];
  server: WorktreeServerConfig;
  /** What starts the server: an item (its id), a raw command, or nothing. */
  start: { id?: string; command: string; label: string; item?: WorktreeActionItem } | null;
  clickByState: Record<WorktreeServerState, WorktreeClickChoice>;
  hooks: NonNullable<WorktreeConfig['hooks']>;
  /** Port reservation, personal over shared. */
  ports: { reserve: boolean; count: number };
}

export const DEFAULT_PORT_COUNT = 10;
export const MAX_PORT_COUNT = 20;

function sourcesOf(personal?: WorktreeConfig, shared?: WorktreeConfig): Set<WorktreeDiscoverySource> {
  const chosen = personal?.discovery?.sources ?? shared?.discovery?.sources;
  return new Set(Array.isArray(chosen) ? chosen.filter((s) => WORKTREE_DISCOVERY_SOURCES.includes(s)) : WORKTREE_DISCOVERY_SOURCES);
}

function validAction(def: unknown): def is WorktreeActionDef {
  const d = def as WorktreeActionDef;
  return !!d && typeof d.id === 'string' && !!d.id.trim() && (typeof d.cmd === 'string' || d.hidden === true);
}

export function mergeWorktreeConfig({ personal, shared, launch, detected }: MergeInput): MergedWorktree {
  const pins = new Set([...(shared?.pins ?? []), ...(personal?.pins ?? [])].filter((p) => typeof p === 'string'));
  const hidden = new Set([...(shared?.discovery?.hide ?? []), ...(personal?.discovery?.hide ?? [])]);
  const sources = sourcesOf(personal, shared);

  const detectedLayer = (item: DetectedItem): WorktreeConfigLayer => (item.source === 'launch' ? 'launch' : 'detected');
  const found = [...launch, ...detected].filter((i) => sources.has(i.source as WorktreeDiscoverySource));
  const byId = new Map<string, WorktreeActionItem>(found.map((i) => [i.id, { ...i, layer: detectedLayer(i), pinned: false }]));

  // Declared actions: shared first, then personal masks by id.
  const declared = new Map<string, { def: WorktreeActionDef; layer: WorktreeConfigLayer }>();
  for (const def of (shared?.actions ?? []).filter(validAction)) declared.set(def.id, { def, layer: 'shared' });
  for (const def of (personal?.actions ?? []).filter(validAction)) {
    if (def.hidden) declared.delete(def.id);
    else declared.set(def.id, { def, layer: 'personal' });
  }

  const actions: WorktreeActionItem[] = [];
  for (const { def, layer } of declared.values()) {
    const ref = byId.get(def.cmd.trim());
    const base = byId.get(def.id);
    const item: WorktreeActionItem = {
      // Customising a detected item (same id) keeps its source so it stays in its group.
      ...(base ?? {}),
      ...(ref ? { command: ref.command, ...(ref.cwd ? { cwd: ref.cwd } : {}), ...(ref.env ? { env: ref.env } : {}), ...(ref.port ? { port: ref.port } : {}), ...(ref.url ? { url: ref.url } : {}) } : { command: def.cmd }),
      id: def.id,
      source: base?.source ?? 'action',
      layer,
      label: def.label?.trim() || base?.label || def.id,
      mode: def.mode ?? base?.mode ?? 'background',
      ...(def.when?.length ? { when: def.when } : {}),
      pinned: false,
    };
    if (base) byId.delete(def.id);
    actions.push(item);
  }

  const items = [...actions, ...byId.values()]
    .filter((i) => !hidden.has(i.id))
    .map((i) => ({ ...i, pinned: pins.has(i.id) }));

  const server: WorktreeServerConfig = { ...(shared?.server ?? {}), ...(personal?.server ?? {}) };
  const hooks = { ...(shared?.hooks ?? {}), ...(personal?.hooks ?? {}) };
  // Start, Logs, Stop and the probe each take a command or the id of a command (`action:…`, `npm:dev`).
  const byRef = (ref: string | undefined) => {
    const r = ref?.trim();
    if (!r) return undefined;
    return items.find((i) => i.id === r) ?? [...launch, ...detected].map((i) => ({ ...i, layer: detectedLayer(i), pinned: false })).find((i) => i.id === r);
  };
  const startRef = server.start?.trim();
  let start: MergedWorktree['start'] = null;
  if (startRef) {
    const item = byRef(startRef);
    start = item ? { id: item.id, command: item.command, label: item.label, item } : { command: startRef, label: 'start' };
  }
  // Stop, Logs and the probe run as commands: an id resolves to that command here, once.
  for (const key of ['stop', 'logs'] as const) {
    const item = byRef(server[key]);
    if (item) server[key] = item.command;
  }
  const probeItem = byRef(server.probe?.command);
  if (probeItem && server.probe) server.probe = { ...server.probe, command: probeItem.command };

  const portsCfg = { ...(shared?.ports ?? {}), ...(personal?.ports ?? {}) };
  const count = Math.min(MAX_PORT_COUNT, Math.max(1, Math.round(Number(portsCfg.count) || DEFAULT_PORT_COUNT)));
  return { items, server, start, clickByState: worktreeClickByState(server.clickByState), hooks, ports: { reserve: portsCfg.reserve === true, count } };
}
