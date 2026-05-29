import type { AnyDomainEvent } from '../../domain/events.js';

/**
 * Implemented by write-through in-memory caches so they can stay coherent
 * across a shared-storage, multi-instance deployment.
 *
 * In such a deployment each server keeps its own write-through cache. When a
 * sibling instance mutates the shared store (Supabase/Postgres) it forwards
 * the corresponding domain event over the event hub. The receiving instance's
 * cache has not seen that write, so it is stale. Before the remote event is
 * dispatched to listeners (UI broadcasts, etc.), every registered cache gets a
 * chance to re-sync the entities the event touches via `applyRemoteEvent`.
 *
 * Implementations:
 *  - inspect the event for the entity id(s) they own,
 *  - re-read those entities from the source store, updating or evicting the
 *    cached entry,
 *  - ignore events that touch nothing they cache.
 *
 * This is the single, uniform extension point for cross-instance cache
 * coherence: a new cached store only needs to implement this interface and be
 * registered in the container's remote-cache list — no per-type wiring in the
 * broadcast layer.
 */
export interface RemoteCacheSync {
  applyRemoteEvent(event: AnyDomainEvent): Promise<void>;
}

/** Runtime guard — lets the container collect caches that opt into remote sync.
 * Generic so `array.filter(isRemoteCacheSync)` narrows the element type. */
export function isRemoteCacheSync<T>(value: T): value is T & RemoteCacheSync {
  return typeof (value as Partial<RemoteCacheSync>)?.applyRemoteEvent === 'function';
}
