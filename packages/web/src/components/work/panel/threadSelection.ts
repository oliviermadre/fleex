import type { AgentThread } from '@fleex/shared';

/**
 * Which thread the Threads panel shows: the persisted selection when it still
 * exists, else the most recent open thread, else the most recent one. `threads`
 * is newest first (threadStore order). Null when the ticket has no thread.
 */
export function resolveSelectedThread(threads: readonly AgentThread[], selectedId: string | null): AgentThread | null {
  if (threads.length === 0) return null;
  const persisted = selectedId ? threads.find((t) => t.id === selectedId) : undefined;
  if (persisted) return persisted;
  const open = threads.find((t) => t.status === 'running' || t.status === 'waiting');
  return open ?? threads[0]!;
}

