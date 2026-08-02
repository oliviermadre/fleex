import { WebSocket } from 'ws';

/**
 * `app.inject()` cannot perform an HTTP upgrade, so the WebSocket suites boot a
 * real listener and talk to it with a real `ws` client. These helpers exist to
 * keep that from turning every assertion into a pile of nested callbacks — and,
 * more importantly, to make "nothing arrived" an assertable outcome rather than
 * a test that passes because it forgot to wait.
 *
 * `ws` is already a direct dependency of the server (it backs
 * `@fastify/websocket`), so nothing new is pulled in for tests.
 */

/** Default ceiling for a frame we DO expect. Generous; failures are real. */
const RECEIVE_TIMEOUT_MS = 2_000;

/**
 * Window we wait before concluding a frame will never arrive. Short on
 * purpose: every negative assertion pays it in wall-clock time.
 */
const SILENCE_WINDOW_MS = 250;

export interface CloseInfo {
  code: number;
  reason: string;
}

/** Resolves once the socket is open; rejects if it closes first. */
export function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error(`socket did not open: ${url}`)), RECEIVE_TIMEOUT_MS);

    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      reject(new Error(`socket closed before opening: ${code} ${reason.toString()}`));
    });
    ws.once('error', () => {
      // A rejected upgrade surfaces as both `error` and `close`; `close`
      // carries the code we actually want, so this listener only exists to
      // stop `ws` from throwing an unhandled 'error' event.
    });
  });
}

/**
 * Resolves with the close frame instead of the socket. Used for the auth
 * rejections, where never opening IS the expected outcome.
 */
export function closeInfo(url: string): Promise<CloseInfo> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`socket neither closed nor errored: ${url}`));
    }, RECEIVE_TIMEOUT_MS);

    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    ws.once('error', () => { /* see openSocket */ });
  });
}

/** Next text frame, parsed as JSON. Rejects on timeout. */
export function nextMessage<T = unknown>(ws: WebSocket, timeoutMs = RECEIVE_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('timed out waiting for a WebSocket message'));
    }, timeoutMs);

    function onMessage(raw: Buffer, isBinary: boolean): void {
      if (isBinary) return; // terminal protocol frames are not what callers mean
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(JSON.parse(raw.toString()) as T);
    }

    ws.on('message', onMessage);
  });
}

/**
 * Collects every text frame received during `windowMs`. The counterpart to
 * `nextMessage` for negative assertions: a targeted broadcast is only correct
 * if the agents it does NOT target stay silent, and that can only be observed
 * by waiting and finding nothing.
 */
export function collectMessages(ws: WebSocket, windowMs = SILENCE_WINDOW_MS): Promise<unknown[]> {
  return new Promise((resolve) => {
    const received: unknown[] = [];
    const onMessage = (raw: Buffer, isBinary: boolean): void => {
      if (!isBinary) received.push(JSON.parse(raw.toString()));
    };
    ws.on('message', onMessage);
    setTimeout(() => {
      ws.off('message', onMessage);
      resolve(received);
    }, windowMs);
  });
}

/**
 * Waits until the server has drained everything sent on this socket so far.
 *
 * There is no application-level ack for `subscribe`, so a test that sends one
 * and immediately triggers a broadcast races the server's message handler.
 * A ping/pong round-trip is the fix: WebSocket frames are processed in order,
 * so once our pong comes back, the frames queued ahead of the ping have
 * already been dispatched. Deterministic, and faster than guessing at a sleep.
 */
export function roundTrip(ws: WebSocket, timeoutMs = RECEIVE_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ping/pong round-trip timed out')), timeoutMs);
    ws.once('pong', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.ping();
  });
}

/** Resolves once the socket is fully closed. Safe to call twice. */
export function closeSocket(ws: WebSocket | undefined): Promise<void> {
  if (!ws || ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    ws.once('close', () => resolve());
    ws.close();
  });
}
