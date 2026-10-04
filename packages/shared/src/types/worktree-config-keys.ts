import type { WorktreeActionDef, WorktreeConfig, WorktreeDiscoverySource } from './worktree-actions.js';

/**
 * A config key: the unit that "Partager" / "Garder pour moi" moves between the
 * personal layer and `.fleex/worktree.json`, and that the settings screen
 * writes one at a time.
 *
 *   hooks.setup · hooks.teardown · hooks.timeoutSec
 *   server.mode · server.start · server.logs · server.stop · server.probe · server.url · server.clickByState
 *   action:<id> · pin:<id> · hide:<id>
 *   discovery.sources · ports
 */
export type WorktreeConfigKey = string;

const FIELD_KEYS = [
  'hooks.setup',
  'hooks.teardown',
  'hooks.timeoutSec',
  'server.mode',
  'server.start',
  'server.logs',
  'server.stop',
  'server.probe',
  'server.url',
  'server.clickByState',
  'discovery.sources',
  'ports',
] as const;

export function isWorktreeConfigKey(key: string): boolean {
  if ((FIELD_KEYS as readonly string[]).includes(key)) return true;
  return /^(action|pin|hide):.+/.test(key);
}

/** The value a key holds in a layer (`true` for a pin or a hide), undefined when absent. */
export function getConfigKey(config: WorktreeConfig | null | undefined, key: WorktreeConfigKey): unknown {
  if (!config) return undefined;
  const [kind, ...rest] = key.split(':');
  const id = rest.join(':');
  if (rest.length && kind === 'action') return config.actions?.find((a) => a.id === id);
  if (rest.length && kind === 'pin') return config.pins?.includes(id) ? true : undefined;
  if (rest.length && kind === 'hide') return config.discovery?.hide?.includes(id) ? true : undefined;
  switch (key) {
    case 'hooks.setup': return config.hooks?.setup;
    case 'hooks.teardown': return config.hooks?.teardown;
    case 'hooks.timeoutSec': return config.hooks?.timeoutSec;
    case 'server.mode': return config.server?.mode;
    case 'server.start': return config.server?.start;
    case 'server.logs': return config.server?.logs;
    case 'server.stop': return config.server?.stop;
    case 'server.probe': return config.server?.probe;
    case 'server.url': return config.server?.url;
    case 'server.clickByState': return config.server?.clickByState;
    case 'discovery.sources': return config.discovery?.sources;
    case 'ports': return config.ports;
    default: return undefined;
  }
}

/** Drop empty containers so a layer never fills up with `{}` and `[]`. */
function prune(config: WorktreeConfig): WorktreeConfig {
  const out: WorktreeConfig = { ...config };
  const isEmpty = (v: unknown) => v === undefined || (Array.isArray(v) ? v.length === 0 : typeof v === 'object' && v !== null && Object.keys(v).length === 0);
  for (const k of ['hooks', 'server', 'discovery'] as const) {
    const obj = out[k] as Record<string, unknown> | undefined;
    if (obj) {
      const cleaned = Object.fromEntries(Object.entries(obj).filter(([, v]) => !isEmpty(v)));
      if (Object.keys(cleaned).length) (out as Record<string, unknown>)[k] = cleaned;
      else delete out[k];
    }
  }
  for (const k of ['actions', 'pins'] as const) if (isEmpty(out[k])) delete out[k];
  if (out.ports && isEmpty(out.ports)) delete out.ports;
  return out;
}

/**
 * Set a key in a layer (undefined removes it). Returns a new config, never
 * mutates. An action keeps its position when replaced, and is appended when new.
 */
export function setConfigKey(config: WorktreeConfig | null | undefined, key: WorktreeConfigKey, value: unknown): WorktreeConfig {
  const base: WorktreeConfig = { ...(config ?? {}) };
  const [kind, ...rest] = key.split(':');
  const id = rest.join(':');
  if (rest.length && kind === 'action') {
    const actions = [...(base.actions ?? [])];
    const at = actions.findIndex((a) => a.id === id);
    if (value === undefined) {
      if (at >= 0) actions.splice(at, 1);
    } else {
      const def = { ...(value as WorktreeActionDef), id };
      if (at >= 0) actions[at] = def;
      else actions.push(def);
    }
    return prune({ ...base, actions });
  }
  if (rest.length && (kind === 'pin' || kind === 'hide')) {
    const list = kind === 'pin' ? base.pins ?? [] : base.discovery?.hide ?? [];
    const next = value === undefined ? list.filter((x) => x !== id) : list.includes(id) ? list : [...list, id];
    return prune(kind === 'pin' ? { ...base, pins: next } : { ...base, discovery: { ...(base.discovery ?? {}), hide: next } });
  }
  const [group, field] = key.split('.') as [string, string | undefined];
  if (key === 'ports') return prune(value === undefined ? (({ ports: _p, ...r }) => r)(base) : { ...base, ports: value as WorktreeConfig['ports'] });
  if (group === 'hooks' || group === 'server' || group === 'discovery') {
    const obj = { ...((base[group] as Record<string, unknown> | undefined) ?? {}) };
    if (value === undefined) delete obj[field!];
    else obj[field!] = group === 'discovery' ? (value as WorktreeDiscoverySource[]) : value;
    return prune({ ...base, [group]: obj });
  }
  throw new Error(`Unknown config key "${key}"`);
}

/** Every key a layer holds, in a stable order (fields, then actions, pins, hides). */
export function listConfigKeys(config: WorktreeConfig | null | undefined): WorktreeConfigKey[] {
  if (!config) return [];
  return [
    ...FIELD_KEYS.filter((k) => getConfigKey(config, k) !== undefined),
    ...(config.actions ?? []).map((a) => `action:${a.id}`),
    ...(config.pins ?? []).map((p) => `pin:${p}`),
    ...(config.discovery?.hide ?? []).map((h) => `hide:${h}`),
  ];
}

/** Where a key lives: the layer whose value wins, and whether a personal one masks the team's. */
export function keyScope(personal: WorktreeConfig | null | undefined, shared: WorktreeConfig | null | undefined, key: WorktreeConfigKey): { layer: 'personal' | 'shared' | null; masks: boolean } {
  const p = getConfigKey(personal, key) !== undefined;
  const s = getConfigKey(shared, key) !== undefined;
  return { layer: p ? 'personal' : s ? 'shared' : null, masks: p && s };
}
