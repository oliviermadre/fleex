import { describe, it, expect } from 'vitest';
import { createSdkTraceCapture } from '../../src/application/utils/sdk-trace-capture.js';

describe('createSdkTraceCapture', () => {
  it('returns an empty string when nothing was captured', () => {
    const cap = createSdkTraceCapture();
    expect(cap.getTrace()).toBe('');
  });

  it('accumulates stderr chunks in order', () => {
    const cap = createSdkTraceCapture();
    cap.onStderr('first ');
    cap.onStderr('second ');
    cap.onStderr('third');
    expect(cap.getTrace()).toBe('first second third');
  });

  it('keeps the tail when exceeding maxBytes and flags truncation', () => {
    const cap = createSdkTraceCapture(10);
    cap.onStderr('0123456789'); // exactly at cap, not truncated yet
    expect(cap.getTrace()).toBe('0123456789');

    cap.onStderr('ABCDE'); // now 15 chars → keep last 10
    const trace = cap.getTrace();
    expect(trace.startsWith('…[tronqué]')).toBe(true);
    expect(trace.endsWith('56789ABCDE')).toBe(true);
  });

  it('preserves the end of the stream (where the exit reason lives)', () => {
    const cap = createSdkTraceCapture(20);
    for (let i = 0; i < 100; i++) cap.onStderr(`line${i}\n`);
    cap.onStderr('FATAL: spawn failed');
    expect(cap.getTrace()).toContain('FATAL: spawn failed');
  });
});
