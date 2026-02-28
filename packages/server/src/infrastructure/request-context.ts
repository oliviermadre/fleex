/**
 * Async-local request context.
 *
 * Stores the authenticated userId for the current request so that
 * gateway tunnel adapters can resolve the correct per-user tunnel
 * without threading userId through every function signature.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContextData {
  userId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContextData>();

/**
 * Get the userId from the current request context.
 * Throws if called outside a request context (e.g. at startup).
 */
export function getCurrentUserId(): string {
  const ctx = requestContext.getStore();
  if (!ctx) {
    throw new Error('No request context — gateway operations require an authenticated user');
  }
  return ctx.userId;
}
