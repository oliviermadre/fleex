import { useCallback, useEffect, useState } from 'react';
import { keyScope, type WorktreeConfigKey, type WorktreeHook, type WorktreeSettingsResponse } from '@fleex/shared';
import * as api from '../../../services/api';
import { useToastStore } from '../../../stores/toastStore';

export type Layer = 'personal' | 'shared';

const SHARED_TOAST = 'Écrit dans .fleex/worktree.json — à committer';

/**
 * State and writes of Settings › Actions et Hooks for one repo and one of its
 * worktrees (whose `.fleex/worktree.json` is the shared layer).
 *
 * A key is written where it lives: in the personal layer when it is there (or
 * nowhere yet), in the shared file when only the team has it. Moving it is
 * what Partager / Garder pour moi are for.
 */
export function useWorktreeSettings(repo: string, path: string | null) {
  const [settings, setSettings] = useState<WorktreeSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSettings(await api.fetchWorktreeSettings(repo, path));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [repo, path]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  /** The layer a key would be written to now. */
  const layerOf = useCallback(
    (key: WorktreeConfigKey): Layer => {
      if (!settings || !path) return 'personal';
      return keyScope(settings.personal, settings.shared, key).layer ?? 'personal';
    },
    [settings, path],
  );

  /** Write several keys (each in its own layer, or `force` one). Undefined removes. Resolves false on failure. */
  const write = useCallback(
    async (entries: [WorktreeConfigKey, unknown][], force?: Layer): Promise<boolean> => {
      let next = settings;
      let touchedShared = false;
      try {
        for (const [key, value] of entries) {
          const layer = force ?? layerOf(key);
          if (layer === 'shared') touchedShared = true;
          next = await api.setWorktreeConfigKey(repo, path, layer, key, value);
        }
      } catch {
        await reload();
        return false; // toasted
      }
      if (next) setSettings(next);
      if (touchedShared) useToastStore.getState().addToast('info', SHARED_TOAST);
      return true;
    },
    [settings, layerOf, repo, path, reload],
  );

  const share = useCallback(
    async (keys: WorktreeConfigKey[]) => {
      if (!path) return;
      try {
        const res = await api.shareWorktreeKeys(path, keys);
        setSettings(res.settings);
        useToastStore.getState().addToast('success', `Ajouté à .fleex/worktree.json, à committer`);
      } catch { /* toasted */ }
    },
    [path],
  );

  const unshare = useCallback(
    async (keys: WorktreeConfigKey[], removeFromFile: boolean) => {
      if (!path) return;
      try {
        const res = await api.unshareWorktreeKeys(path, keys, removeFromFile);
        setSettings(res.settings);
        useToastStore.getState().addToast('success', removeFromFile ? 'Gardé pour toi et retiré de .fleex/worktree.json (à committer)' : 'Gardé pour toi : ta version masque celle de l\'équipe');
      } catch { /* toasted */ }
    },
    [path],
  );

  /** "Tester dans le worktree courant": run a hook (a draft command) in the action engine; resolves with the run id. */
  const testHook = useCallback(
    async (hook: WorktreeHook, command: string): Promise<string | null> => {
      if (!path) return null;
      try {
        const res = await api.runWorktreeHook(path, hook, command);
        return res.runId ?? null;
      } catch {
        return null;
      }
    },
    [path],
  );

  return { settings, loading, error, reload, layerOf, write, share, unshare, testHook };
}

export type WorktreeSettingsApi = ReturnType<typeof useWorktreeSettings>;
