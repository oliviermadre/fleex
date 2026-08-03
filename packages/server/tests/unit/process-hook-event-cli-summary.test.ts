import { describe, it, expect, vi } from 'vitest';

import type { HookEventPayload } from '@fleex/shared';

import { EventBus } from '../../src/application/event-bus.js';
import { ProcessHookEventUseCase } from '../../src/application/use-cases/process-hook-event.js';

import type { LoggerPort } from '../../src/application/ports/logger.port.js';
import type { SessionStorePort } from '../../src/application/ports/session-store.port.js';
import type { GenerateCliSessionSummaryUseCase } from '../../src/application/use-cases/generate-cli-session-summary.js';
import type {
  IngestCliSessionUseCase,
  IngestCliSessionResult,
} from '../../src/application/use-cases/ingest-cli-session.js';

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as LoggerPort;

function sessionEndEvent(): HookEventPayload {
  return {
    event: 'sessionEnd',
    cwd: '/tmp/worktree',
    timestamp: Date.now(),
    payload: { session_id: 'sess-1', transcript_path: '/tmp/t.jsonl' },
  } as HookEventPayload;
}

function makeUseCase(
  ingestResult: IngestCliSessionResult,
  summaryExecute: () => Promise<void> = async () => {},
) {
  const sessionStore = { getAll: vi.fn(async () => []) } as unknown as SessionStorePort;
  const ingest = { execute: vi.fn(async () => ingestResult) } as unknown as IngestCliSessionUseCase;
  const summarySpy = vi.fn(summaryExecute);
  const summary = { execute: summarySpy } as unknown as GenerateCliSessionSummaryUseCase;
  const useCase = new ProcessHookEventUseCase(
    sessionStore,
    new EventBus(),
    logger,
    ingest,
    summary,
  );
  return { useCase, summarySpy };
}

describe('ProcessHookEventUseCase — CLI session summary wiring', () => {
  it('generates a session summary after a CLI session is ingested', async () => {
    const { useCase, summarySpy } = makeUseCase({ ingested: true, ticketId: 'T1' });

    await useCase.execute(sessionEndEvent());

    expect(summarySpy).toHaveBeenCalledTimes(1);
    expect(summarySpy).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      ticketId: 'T1',
      transcriptPath: '/tmp/t.jsonl',
    });
  });

  it('does NOT generate a summary when the session was not ingested', async () => {
    const { useCase, summarySpy } = makeUseCase({ ingested: false, reason: 'not-fleex' });

    await useCase.execute(sessionEndEvent());

    expect(summarySpy).not.toHaveBeenCalled();
  });

  it('never lets a summary failure break the hook (best-effort, non-blocking)', async () => {
    const { useCase, summarySpy } = makeUseCase({ ingested: true, ticketId: 'T1' }, async () => {
      throw new Error('sdk exploded');
    });

    // Must resolve normally despite the summary throwing.
    await expect(useCase.execute(sessionEndEvent())).resolves.toBeDefined();
    expect(summarySpy).toHaveBeenCalledTimes(1);
  });
});
