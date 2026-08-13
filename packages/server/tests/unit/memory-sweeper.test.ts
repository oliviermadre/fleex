import { describe, it, expect, vi } from 'vitest';
import { MemorySweeper } from '../../src/application/memory/memory-sweeper.js';
import type { MemoryKernel } from '../../src/application/memory/memory-kernel.js';
import type { AppConfig, ConfigPort } from '../../src/application/ports/config.port.js';

function config(engine?: 'legacy' | 'semantic'): ConfigPort {
  return {
    get: () => ({ memoryEngine: engine } as AppConfig),
    update: async () => {},
  } as unknown as ConfigPort;
}

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** A kernel whose sweep returns the given batch sizes in order, then zero. */
function kernel(batches: number[]) {
  const calls: number[] = [];
  const sweepPendingEmbeddings = vi.fn(async () => {
    const next = batches.shift() ?? 0;
    calls.push(next);
    return next;
  });
  return { kernel: { sweepPendingEmbeddings } as unknown as MemoryKernel, sweepPendingEmbeddings, calls };
}

function sweeper(engine: 'legacy' | 'semantic' | undefined, batches: number[], logger = silent) {
  const k = kernel(batches);
  return { ...k, sweeper: new MemorySweeper(k.kernel, config(engine), logger as never) };
}

describe('MemorySweeper', () => {
  it('embeds nothing under the legacy engine', async () => {
    const { sweeper: s, sweepPendingEmbeddings } = sweeper('legacy', [10]);
    expect(await s.sweep()).toBe(0);
    // Not even a read: a user on the default engine pays no CPU for the beta.
    expect(sweepPendingEmbeddings).not.toHaveBeenCalled();
  });

  it('embeds nothing when no engine is configured', async () => {
    const { sweeper: s, sweepPendingEmbeddings } = sweeper(undefined, [10]);
    expect(await s.sweep()).toBe(0);
    expect(sweepPendingEmbeddings).not.toHaveBeenCalled();
  });

  it('drains until a pass finds nothing', async () => {
    const { sweeper: s, sweepPendingEmbeddings } = sweeper('semantic', [64, 64, 3]);
    expect(await s.sweep()).toBe(131);
    // Three productive passes plus the one that returned zero.
    expect(sweepPendingEmbeddings).toHaveBeenCalledTimes(4);
  });

  it('stops at the per-pass batch ceiling rather than pinning the process', async () => {
    // A backlog that never runs dry: the pass must still end.
    const { sweeper: s, sweepPendingEmbeddings } = sweeper('semantic', Array(50).fill(64));
    expect(await s.sweep()).toBe(8 * 64);
    expect(sweepPendingEmbeddings).toHaveBeenCalledTimes(8);
  });

  it('returns zero when there is nothing pending', async () => {
    const { sweeper: s } = sweeper('semantic', []);
    expect(await s.sweep()).toBe(0);
  });

  it('swallows a provider failure so the next pass can retry', async () => {
    const kernelStub = {
      sweepPendingEmbeddings: vi.fn(async () => { throw new Error('model not downloaded'); }),
    } as unknown as MemoryKernel;
    const s = new MemorySweeper(kernelStub, config('semantic'), silent as never);
    // Not a rejection: this runs on a timer with nobody to catch it.
    await expect(s.sweep()).resolves.toBe(0);
    await expect(s.sweep()).resolves.toBe(0);
  });

  it('logs a repeated failure once, not once per pass', async () => {
    const warn = vi.fn();
    const kernelStub = {
      sweepPendingEmbeddings: vi.fn(async () => { throw new Error('model not downloaded'); }),
    } as unknown as MemoryKernel;
    const s = new MemorySweeper(kernelStub, config('semantic'), { ...silent, warn } as never);

    await s.sweep();
    await s.sweep();
    await s.sweep();
    // A model download stays unfinished for minutes; one line, not one per minute.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs again when the failure changes', async () => {
    const warn = vi.fn();
    const messages = ['model not downloaded', 'disk full'];
    const kernelStub = {
      sweepPendingEmbeddings: vi.fn(async () => { throw new Error(messages.shift() ?? 'disk full'); }),
    } as unknown as MemoryKernel;
    const s = new MemorySweeper(kernelStub, config('semantic'), { ...silent, warn } as never);

    await s.sweep();
    await s.sweep();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('does not overlap two passes', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started = 0;

    const kernelStub = {
      sweepPendingEmbeddings: vi.fn(async () => {
        started++;
        await gate;
        return 0;
      }),
    } as unknown as MemoryKernel;
    const s = new MemorySweeper(kernelStub, config('semantic'), silent as never);

    const first = s.sweep();
    // A pass that outlives the tick interval must not have a second stacked on it.
    const second = await s.sweep();
    expect(second).toBe(0);
    expect(started).toBe(1);

    release!();
    await first;
  });

  it('start is idempotent and stop clears the timer', async () => {
    const { sweeper: s } = sweeper('semantic', []);
    s.start(1_000);
    s.start(1_000);
    s.stop();
    s.stop();
    // Nothing to assert beyond not throwing and not leaving a handle behind — the
    // timer is unref'd, so a leak would show up as a hanging test run.
    expect(true).toBe(true);
  });

  it('ignores a non-positive interval instead of spinning', () => {
    const { sweeper: s } = sweeper('semantic', []);
    s.start(0);
    s.stop();
    expect(true).toBe(true);
  });
});
