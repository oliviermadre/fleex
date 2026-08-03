/**
 * Server capabilities — what the running instance can actually do.
 *
 * Not every storage driver implements every store. Rather than letting clients
 * discover the gap as a 404 (indistinguishable from a typo), the server
 * advertises its feature set so the UI can disable and explain instead.
 */
export type StorageDriverName = 'json' | 'sqlite' | 'pgsql' | 'supabase';

export interface ServerCapabilities {
  storageDriver: StorageDriverName;
  features: {
    /** Workflow templates, runs and step runs are all persisted and orchestrated. */
    workflows: boolean;
    /** Key/value store is available (read cursors, scratchpad). */
    kvStore: boolean;
    /** Uploaded files live in remote object storage rather than on local disk. */
    remoteFileStorage: boolean;
  };
}
