import type { AppConfig } from '../../application/ports/config.port.js';

/**
 * Env var carrying the active workspace's basePath (set by the CLI's
 * `activateWorkspace`). When present it overrides the persisted config — making
 * `~/.fleex/workspaces.json` the source of truth for the worktree base path
 * instead of the DB. Keep this name in sync with the CLI's `BASE_PATH_ENV`.
 */
export const BASE_PATH_ENV = 'FLEEX_REPOSITORIES_BASE_PATH';

/**
 * Override `config.basePath` from {@link BASE_PATH_ENV} when set. Call inside a
 * config adapter's `init()` AFTER loading from disk/DB and BEFORE `resolveTilde()`
 * (the env value may itself contain a leading `~`). No-op when the env is unset,
 * preserving the legacy DB-driven behaviour.
 */
export function applyBasePathEnvOverride(config: AppConfig): void {
  const v = process.env[BASE_PATH_ENV];
  if (v && v.trim() !== '') {
    config.basePath = v;
  }
}
