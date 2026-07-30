import { join } from 'node:path';
import { appendFile } from 'node:fs/promises';
import type { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';

/**
 * Append agent events to the per-execution JSONL file, grouped by execution so a
 * mixed batch costs one write per file instead of one per event.
 *
 * Shared by every SQL adapter's `mirrorRemoteEvents`: the execution row lives in
 * the (possibly shared) database, but the event stream is always local JSONL, so
 * mirroring a sibling's events is purely a filesystem concern.
 */
export async function appendAgentEventsToJsonl(
  eventsDir: string,
  events: AgentEventEntity[],
): Promise<void> {
  if (events.length === 0) return;

  const byExecution = new Map<string, string[]>();
  for (const event of events) {
    const lines = byExecution.get(event.executionId);
    const line = JSON.stringify(event.toDTO()) + '\n';
    if (lines) lines.push(line);
    else byExecution.set(event.executionId, [line]);
  }

  for (const [executionId, lines] of byExecution) {
    await appendFile(join(eventsDir, `${executionId}.jsonl`), lines.join(''), 'utf-8');
  }
}
