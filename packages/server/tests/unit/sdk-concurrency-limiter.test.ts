import { describe, it, expect } from 'vitest';

import { SdkConcurrencyLimiter } from '../../src/application/services/sdk-concurrency-limiter.js';

/** A promise paired with its resolve fn, so tests can hold tasks open. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Drain all pending microtasks (a macrotask boundary guarantees this). */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('SdkConcurrencyLimiter', () => {
  it('never runs more than the configured limit at once', async () => {
    const limiter = new SdkConcurrencyLimiter(() => 2);
    let running = 0;
    let peak = 0;
    const gates = [deferred(), deferred(), deferred(), deferred()];

    const tasks = gates.map((g) =>
      limiter.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await g.promise;
        running--;
      }),
    );

    // Let the first batch acquire.
    await flush();
    expect(limiter.snapshot.active).toBe(2);
    expect(limiter.snapshot.waiting).toBe(2);

    gates.forEach((g) => g.resolve());
    await Promise.all(tasks);

    expect(peak).toBe(2);
    expect(limiter.snapshot).toEqual({ active: 0, waiting: 0, limit: 2 });
  });

  it('admits a waiter as soon as a slot frees', async () => {
    const limiter = new SdkConcurrencyLimiter(() => 1);
    const order: number[] = [];
    const g1 = deferred();

    const release1 = await limiter.acquire();
    order.push(1);

    const second = limiter.run(async () => {
      order.push(2);
      await g1.promise;
    });
    await flush();
    expect(order).toEqual([1]); // second is blocked

    release1();
    await flush();
    expect(order).toEqual([1, 2]); // freeing slot 1 admits the waiter

    g1.resolve();
    await second;
  });

  it('release is idempotent (double-call does not over-admit)', async () => {
    const limiter = new SdkConcurrencyLimiter(() => 1);
    const release = await limiter.acquire();
    release();
    release(); // no-op
    expect(limiter.snapshot.active).toBe(0);

    // A fresh acquire still respects the limit of 1.
    const r2 = await limiter.acquire();
    expect(limiter.snapshot.active).toBe(1);
    r2();
  });

  it('raising the limit at runtime admits multiple waiters on next release', async () => {
    let limit = 1;
    const limiter = new SdkConcurrencyLimiter(() => limit);
    const r0 = await limiter.acquire();

    const gates = [deferred(), deferred()];
    let running = 0;
    let peak = 0;
    const waiters = gates.map((g) =>
      limiter.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await g.promise;
        running--;
      }),
    );
    await flush();
    expect(limiter.snapshot.waiting).toBe(2);

    limit = 3; // raise the ceiling
    r0(); // one release should now drain both waiters
    await flush();
    expect(peak).toBe(2);

    gates.forEach((g) => g.resolve());
    await Promise.all(waiters);
  });

  it('treats an invalid/zero capacity as 1', async () => {
    const limiter = new SdkConcurrencyLimiter(() => 0);
    expect(limiter.snapshot.limit).toBe(1);
    const g = deferred();
    let active = 0;
    let peak = 0;
    const tasks = [0, 1].map(() =>
      limiter.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await g.promise;
        active--;
      }),
    );
    await flush();
    expect(limiter.snapshot.active).toBe(1);
    g.resolve();
    await Promise.all(tasks);
    expect(peak).toBe(1);
  });
});
