import type { ServerCapabilities, StorageDriverName } from '@fleex/shared';

/**
 * Structural view of the container needed to answer "what can this server do?".
 *
 * Declared structurally rather than importing `Container` so the application
 * layer keeps no dependency on infrastructure.
 */
export interface CapabilitySource {
  storageDriver: StorageDriverName;
  workflowTemplateStore: unknown;
  workflowRunStore: unknown;
  stepRunStore: unknown;
  createWorkflowRun: unknown;
  resolveHumanGate: unknown;
  retryStep: unknown;
  cancelWorkflowRun: unknown;
  kvStore: unknown;
}

/**
 * The single source of truth for feature availability.
 *
 * Every consumer — the /api/capabilities route, the 503 guard on workflow routes
 * and the startup log — must go through this function. Duplicating the predicate
 * is what let workflows silently 404 on two drivers in the first place.
 */
export function resolveCapabilities(source: CapabilitySource): ServerCapabilities {
  return {
    storageDriver: source.storageDriver,
    features: {
      workflows: Boolean(
        source.workflowTemplateStore &&
        source.workflowRunStore &&
        source.stepRunStore &&
        source.createWorkflowRun &&
        source.resolveHumanGate &&
        source.retryStep &&
        source.cancelWorkflowRun,
      ),
      kvStore: Boolean(source.kvStore),
      remoteFileStorage: source.storageDriver === 'supabase',
    },
  };
}
