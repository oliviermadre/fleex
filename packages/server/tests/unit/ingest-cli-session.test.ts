import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IngestCliSessionUseCase } from '../../src/application/use-cases/ingest-cli-session.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { AgentEventStorePort } from '../../src/application/ports/agent-event-store.port.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';

const TICKET_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
let dir: string;

/** Write a transcript with one assistant usage line under the given entrypoint. */
function transcript(path: string, entrypoint: string, cwd: string) {
  const line = JSON.stringify({
    entrypoint, cwd, timestamp: '2026-06-18T10:00:00Z', type: 'assistant',
    message: { model: 'claude-opus-4-8', usage: {
      input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 1000,
      cache_creation: { ephemeral_1h_input_tokens: 500, ephemeral_5m_input_tokens: 0 },
    } },
  });
  writeFileSync(path, line + '\n');
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fleex-cli-ingest-'));
  writeFileSync(join(dir, '.fleex.json'), JSON.stringify({ ticketId: TICKET_ID }));
  transcript(join(dir, 'cli.jsonl'), 'cli', dir);
  transcript(join(dir, 'sdk.jsonl'), 'sdk-ts', dir);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as LoggerPort;

function makeUseCase(ticketExists: boolean) {
  const upsert = vi.fn(async () => {});
  const ticketStore = { getTicketById: vi.fn(async () => (ticketExists ? { id: TICKET_ID } : null)) } as unknown as TicketStorePort;
  const agentEventStore = { upsertCliExecution: upsert } as unknown as AgentEventStorePort;
  return { useCase: new IngestCliSessionUseCase(ticketStore, agentEventStore, logger), upsert };
}

describe('IngestCliSessionUseCase', () => {
  it('ingests a finished CLI Fleex session as a cli: execution with computed cost', async () => {
    const { useCase, upsert } = makeUseCase(true);
    const res = await useCase.execute({ sessionId: 'sess1', transcriptPath: join(dir, 'cli.jsonl'), cwd: dir });

    expect(res.ingested).toBe(true);
    expect(res.ticketId).toBe(TICKET_ID);
    // 100*5e-6 + 200*25e-6 + 1000*0.5e-6 + 500*10e-6 = 0.011
    expect(res.costUsd).toBeCloseTo(0.011, 6);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      executionId: 'cli:sess1',
      mentionId: 'cli:sess1',
      sdkSessionId: 'sess1',
      ticketId: TICKET_ID,
      model: 'claude-opus-4-8',
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 1000,
      cacheCreationTokens: 500,
    }));
  });

  it('skips SDK sessions (already recorded by the server)', async () => {
    const { useCase, upsert } = makeUseCase(true);
    const res = await useCase.execute({ sessionId: 'sess2', transcriptPath: join(dir, 'sdk.jsonl'), cwd: dir });
    expect(res.ingested).toBe(false);
    expect(res.reason).toBe('entrypoint:sdk-ts');
    expect(upsert).not.toHaveBeenCalled();
  });

  it("skips when the ticket isn't in this workspace's DB (routing)", async () => {
    const { useCase, upsert } = makeUseCase(false);
    const res = await useCase.execute({ sessionId: 'sess3', transcriptPath: join(dir, 'cli.jsonl'), cwd: dir });
    expect(res.ingested).toBe(false);
    expect(res.reason).toBe('other-workspace');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('skips a non-Fleex cwd (no .fleex.json ancestor)', async () => {
    const { useCase, upsert } = makeUseCase(true);
    const res = await useCase.execute({ sessionId: 'sess4', transcriptPath: join(dir, 'cli.jsonl'), cwd: tmpdir() });
    expect(res.ingested).toBe(false);
    expect(res.reason).toBe('not-fleex');
    expect(upsert).not.toHaveBeenCalled();
  });
});
