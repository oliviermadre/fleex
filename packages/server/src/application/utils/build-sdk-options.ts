/**
 * Moved to `@fleex/shared` so the companion (the Assistant) builds its options
 * with the very same function as persona runs. Re-exported here so server
 * callers keep their import path.
 */
export {
  buildSdkOptions,
  agentActorEnv,
  effectiveMaxTurns,
  NO_BACKGROUND_TASKS_ENV,
} from '@fleex/shared';
