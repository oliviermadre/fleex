import type { StopAuthor } from '@fleex/shared';
import type { AgentEventStorePort } from '../../src/application/ports/agent-event-store.port.js';
import type { MentionStorePort } from '../../src/application/ports/mention-store.port.js';

/**
 * The process side of runs, for tests that exercise the stop path on real
 * stores without spawning an SDK session: which executions are live for which
 * mention, and what cancelling one does — the contract of
 * `ExecuteAgentUseCase.cancelExecution` (author recorded first, execution ended
 * `interrupted`, mention failed unless the caller keeps it).
 */
export function fakeRunRegistry(agentEvents: AgentEventStorePort, mentions: MentionStorePort) {
  /** executionId → the mention it works for. */
  const running = new Map<string, string>();
  const cancelled: string[] = [];
  const registry = {
    running,
    cancelled,
    runningExecutionIdsForMention: (mentionId: string) => [...running].filter(([, m]) => m === mentionId).map(([id]) => id),
    mentionOfRunningExecution: (executionId: string) => running.get(executionId),
    async cancelExecution(executionId: string, stop?: { by: StopAuthor; reason?: string | null; keepMention?: boolean }) {
      const mentionId = running.get(executionId);
      if (mentionId === undefined) return false;
      if (stop) await agentEvents.markExecutionsStopped([executionId], stop.by, stop.reason ?? null);
      await agentEvents.completeExecution(executionId, 'interrupted');
      running.delete(executionId);
      cancelled.push(executionId);
      if (!stop?.keepMention) {
        const m = await mentions.getById(mentionId);
        if (m) { m.markFailed(); await mentions.save(m); }
      }
      return true;
    },
    async cancelExecutionForMention(mentionId: string, stop?: { by: StopAuthor; reason?: string | null; keepMention?: boolean }) {
      let any = false;
      for (const id of registry.runningExecutionIdsForMention(mentionId)) any = (await registry.cancelExecution(id, stop)) || any;
      return any;
    },
  };
  return registry;
}
