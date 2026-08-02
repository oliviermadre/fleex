import { useEffect } from 'react';
import type { StorageDriverName } from '@fleex/shared';
import { useCapabilitiesStore } from '../stores/capabilitiesStore';

export interface CapabilitiesView {
  /** Storage driver the server runs on, or null while unknown. */
  storageDriver: StorageDriverName | null;
  workflowsAvailable: boolean;
  kvStoreAvailable: boolean;
  remoteFileStorageAvailable: boolean;
  /** false until the boot fetch settled (resolved OR failed). */
  loaded: boolean;
}

/**
 * Read the server capabilities, triggering the one boot fetch on first use.
 *
 * FAIL OPEN: while loading — and if the fetch failed — every feature reads as
 * available. Hiding a feature that actually works is the costly mistake; the
 * opposite just lets the user hit the server's explicit 503, which already
 * explains itself.
 */
export function useCapabilities(): CapabilitiesView {
  const capabilities = useCapabilitiesStore((s) => s.capabilities);
  const loaded = useCapabilitiesStore((s) => s.loaded);
  const load = useCapabilitiesStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    storageDriver: capabilities?.storageDriver ?? null,
    workflowsAvailable: capabilities?.features.workflows ?? true,
    kvStoreAvailable: capabilities?.features.kvStore ?? true,
    remoteFileStorageAvailable: capabilities?.features.remoteFileStorage ?? true,
    loaded,
  };
}
