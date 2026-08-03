/**
 * The JSON driver writes through hostFs.writeFile, which is an HTTP RPC to the
 * host-gateway — not a local fs write. The workflow orchestrator saves a step run
 * on every transition, so unserialized writes could interleave over the network
 * and drop entries. These stores chain their writes; this proves it.
 */
import { describe, it, expect } from 'vitest';

import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { JsonStepRunStore } from '../../src/infrastructure/adapters/json-step-run-store.adapter.js';
import { JsonWorkflowRunStore } from '../../src/infrastructure/adapters/json-workflow-run-store.adapter.js';

import type { LoggerPort } from '../../src/application/ports/logger.port.js';
import type { HostFs } from '../../src/infrastructure/host/types.js';

const silent: LoggerPort = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** HostFs whose writes resolve out of order, like a real network round-trip. */
class LatentHostFs implements HostFs {
  readonly files = new Map<string, string>();
  concurrentWrites = 0;
  maxConcurrentWrites = 0;

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async mkdir(): Promise<void> {}
  async readFile(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`ENOENT: ${path}`);
    return c;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.concurrentWrites += 1;
    this.maxConcurrentWrites = Math.max(this.maxConcurrentWrites, this.concurrentWrites);
    // Random latency: an unserialized implementation would let a stale snapshot
    // land after a fresher one.
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 8)));
    this.files.set(path, content);
    this.concurrentWrites -= 1;
  }

  async appendFile(): Promise<void> {}
  async readdir(): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]> {
    return [];
  }
  async stat(): Promise<{ size: number; mtimeMs: number } | null> {
    return null;
  }
  async rm(): Promise<void> {}
  async readTail(): Promise<string> {
    return '';
  }
}

const SNAPSHOT = {
  name: 'WF',
  emoji: '🔧',
  steps: [
    {
      id: 'step-1',
      name: 'S1',
      executorType: 'agent' as const,
      executorRef: 'p',
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
  entryStepId: 'step-1',
};

describe('JSON workflow stores — concurrent writes', () => {
  it('persists all 20 step runs saved concurrently', async () => {
    const fs = new LatentHostFs();
    const store = new JsonStepRunStore(fs, '/tmp/fleex-concurrent-steps', silent);
    await store.init();

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.save(
          StepRunEntity.create({
            id: `sr-${i}`,
            workflowRunId: 'run-1',
            stepId: 'step-1',
            attempt: i + 1,
          }),
        ),
      ),
    );

    // Never more than one write in flight — that is the serialization guarantee.
    expect(fs.maxConcurrentWrites).toBe(1);

    // The file on disk must be valid JSON holding every entry, not a partial write.
    const raw = fs.files.get('/tmp/fleex-concurrent-steps/.fleex/projects/step-runs.json');
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw as string) as { id: string }[];
    expect(parsed).toHaveLength(20);
    expect(new Set(parsed.map((s) => s.id)).size).toBe(20);
  });

  it('persists all workflow runs saved concurrently', async () => {
    const fs = new LatentHostFs();
    const store = new JsonWorkflowRunStore(fs, '/tmp/fleex-concurrent-runs', silent);
    await store.init();

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.save(
          WorkflowRunEntity.create({
            id: `run-${i}`,
            ticketId: 't-1',
            templateId: 'tmpl-1',
            templateSnapshot: SNAPSHOT,
            triggeredBy: '@t',
            triggeredFrom: 'test',
          }),
        ),
      ),
    );

    expect(fs.maxConcurrentWrites).toBe(1);
    const raw = fs.files.get('/tmp/fleex-concurrent-runs/.fleex/projects/workflow-runs.json');
    const parsed = JSON.parse(raw as string) as { id: string }[];
    expect(parsed).toHaveLength(20);
  });

  it('reloads persisted step runs from disk after a restart', async () => {
    const fs = new LatentHostFs();
    const home = '/tmp/fleex-reload';
    const first = new JsonStepRunStore(fs, home, silent);
    await first.init();
    await first.save(
      StepRunEntity.create({ id: 'sr-1', workflowRunId: 'run-1', stepId: 'step-1' }),
    );

    // Same backing "disk", brand new instance — simulates a server restart.
    const second = new JsonStepRunStore(fs, home, silent);
    await second.init();
    const found = await second.getById('sr-1');
    expect(found?.workflowRunId).toBe('run-1');
  });
});
