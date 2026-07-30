import { useSettingsStore } from '../stores/settingsStore';

interface OwnedExecution {
  readonly instanceId?: string | null;
  readonly instanceLabel?: string | null;
}

/**
 * Name of the machine running this execution, or null when it's the instance
 * we're connected to.
 *
 * Returns null for rows without an owner too (they predate the ownership
 * columns): with nothing to compare, claiming a run is "elsewhere" would be worse
 * than staying quiet.
 */
export function remoteExecutionLabel(exec: OwnedExecution, localInstanceId: string): string | null {
  if (!exec.instanceId || !localInstanceId) return null;
  if (exec.instanceId === localInstanceId) return null;
  return exec.instanceLabel || exec.instanceId;
}

/** Identity of the server this client is talking to (empty until /config loads). */
export function useLocalInstanceId(): string {
  return useSettingsStore((s) => s.settings.instanceId);
}

/**
 * Hook form of `remoteExecutionLabel`. Null means "local (or unknown) — say
 * nothing", which is the common single-instance case.
 */
export function useRemoteExecutionLabel(exec: OwnedExecution | null | undefined): string | null {
  const localInstanceId = useLocalInstanceId();
  if (!exec) return null;
  return remoteExecutionLabel(exec, localInstanceId);
}
