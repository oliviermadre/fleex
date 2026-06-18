/**
 * Captures the stderr trace emitted by the Claude Code SDK subprocess.
 *
 * The `@anthropic-ai/claude-agent-sdk` `query()` exposes a `stderr` callback
 * (and `debug` / `debugFile` options). When the spawned CLI subprocess exits
 * non-zero, the reason is written to stderr — which we'd otherwise discard.
 *
 * Wire `onStderr` to `queryOptions.stderr`, then call `getTrace()` from the
 * failure handlers to surface the captured output. The buffer is bounded and
 * keeps the TAIL of the stream, since the exit reason appears at the end.
 */
export interface SdkTraceCapture {
  /** Attach to `queryOptions.stderr`. */
  onStderr: (data: string) => void;
  /** The accumulated (bounded) trace; '' if nothing was captured. */
  getTrace: () => string;
}

const TRUNCATION_PREFIX = '…[tronqué]\n';

export function createSdkTraceCapture(maxBytes = 256 * 1024): SdkTraceCapture {
  let buf = '';
  let truncated = false;

  return {
    onStderr: (data) => {
      buf += data;
      if (buf.length > maxBytes) {
        buf = buf.slice(buf.length - maxBytes);
        truncated = true;
      }
    },
    getTrace: () => (truncated ? TRUNCATION_PREFIX + buf : buf),
  };
}
