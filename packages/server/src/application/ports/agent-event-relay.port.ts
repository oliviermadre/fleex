import type { AgentEvent } from '@fleex/shared';

/** Where a relayed agent event came from, when it wasn't produced locally. */
export interface AgentEventOrigin {
  /** `AgentExecution.instanceId` of the instance running the agent. */
  instanceId: string;
  /** Human-facing hostname of that instance. */
  instanceLabel: string;
  /** The event's `data` was replaced by a size stub before relaying. */
  truncated?: boolean;
  /**
   * Persona that owns the run, read from the execution row.
   *
   * `execution_end` payloads don't carry it (locally it's known from in-memory
   * state), but a remote listener needs it to broadcast persona status. Resolved
   * where the row is already being re-read, so it costs no extra query.
   */
  personaId?: string;
}

/**
 * Notified for every agent event this server should surface — whether produced by
 * a local run or relayed from a sibling instance.
 *
 * `origin` is absent for local events. Two consumers rely on that distinction:
 * the hub publisher (must never re-publish a relayed event, or three instances
 * would ping-pong it) and the WS layer (a remote `execution_end` has no local
 * `onExecutionComplete` callback, so it has to broadcast persona status itself).
 */
export type AgentEventListener = (event: AgentEvent, origin?: AgentEventOrigin) => void;
