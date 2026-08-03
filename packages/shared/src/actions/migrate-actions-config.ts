import { ACTION_DEFAULT_TIMEOUT_MS } from '../types/action.js';

import { extractPlaceholders, parseCommandLine } from './parse-command-line.js';

import type { ActionDef, ActionIconType, ActionScope } from '../types/action.js';

/** Shape of the two legacy arrays this migration folds into one registry. */
interface LegacyAction {
  id?: unknown;
  icon?: unknown;
  iconType?: unknown;
  label?: unknown;
  actionType?: unknown;
  actionValue?: unknown;
}

const ICON_TYPES: ActionIconType[] = ['svg', 'base64', 'path', 'url'];

/**
 * Folds the legacy `pinnedIcons` + `workspaceActions` arrays into a single
 * `actions` registry, in place.
 *
 * Lives here rather than in `migrations/` because `MigrationContext` only
 * exposes `exec(sql)` with no way to read rows back — a JSON transform is
 * impracticable there. The config adapters already carry this kind of reshaping
 * (see the `repositoriesBasePath → basePath` rename).
 *
 * @returns true when `data` was modified and must be written back.
 */
export function migrateActionsConfig(data: Record<string, unknown>): boolean {
  // Idempotent: the presence of `actions` means the migration already ran.
  if ('actions' in data && Array.isArray(data['actions'])) return false;

  const pinned = asArray(data['pinnedIcons']);
  const workspace = asArray(data['workspaceActions']);
  const hadLegacyKeys = 'pinnedIcons' in data || 'workspaceActions' in data;

  if (!hadLegacyKeys) return false;

  const actions: ActionDef[] = [
    ...pinned.map((entry) => convert(entry, 'global')),
    ...workspace.map((entry) => convert(entry, 'workspace')),
  ].filter((a): a is ActionDef => a !== null);

  data['actions'] = actions;
  delete data['pinnedIcons'];
  delete data['workspaceActions'];
  return true;
}

function asArray(value: unknown): LegacyAction[] {
  return Array.isArray(value) ? (value as LegacyAction[]) : [];
}

function convert(entry: LegacyAction, scope: ActionScope): ActionDef | null {
  if (typeof entry !== 'object' || entry === null) return null;

  const id = typeof entry.id === 'string' && entry.id ? entry.id : null;
  if (!id) return null;

  const iconType = ICON_TYPES.includes(entry.iconType as ActionIconType)
    ? (entry.iconType as ActionIconType)
    : 'svg';

  // Ids are carried over verbatim so display order, palette entries and any
  // muscle memory around them survive the migration.
  //
  // `label` falls back to the id: the legacy shapes never required one, but
  // `validateActionDefs` does. Emitting a def our own validator rejects would
  // make every subsequent `PUT /api/config` fail — including the unrelated ones
  // that round-trip the whole settings object.
  const base = {
    id,
    label: typeof entry.label === 'string' && entry.label.trim() ? entry.label : id,
    scope,
    icon: typeof entry.icon === 'string' ? entry.icon : '',
    iconType,
    enabled: true,
  };

  const value = typeof entry.actionValue === 'string' ? entry.actionValue.trim() : '';

  // A legacy entry with no value has nothing to run or open, and every `kind`
  // requires a non-empty payload. Drop it rather than emit an invalid def.
  if (!value) return null;

  if (entry.actionType === 'url') {
    return { ...base, kind: 'url', url: value };
  }

  const { command, args, needsShell } = parseCommandLine(value);

  if (!needsShell && command) {
    return { ...base, kind: 'exec', command, args, timeoutMs: ACTION_DEFAULT_TIMEOUT_MS };
  }

  // Pipes, redirections, globs, expansions… Keeping these as `kind: 'shell'` is
  // what makes "existing pinned actions still work" true; rewriting them as
  // execFile would silently change their behaviour.
  const { script, positional } = extractPlaceholders(value);
  return { ...base, kind: 'shell', script, args: positional, timeoutMs: ACTION_DEFAULT_TIMEOUT_MS };
}
