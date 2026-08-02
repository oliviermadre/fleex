import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { WebSocket } from 'ws';
import { WS_PATH } from '@fleex/shared';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import { openSocket, nextMessage, closeSocket } from '../../helpers/ws-client.js';

/**
 * `/ws` is the browser's single multiplexed channel: tickets, personas,
 * skills, repositories, dashboard, agent events and the binary terminal
 * protocol all ride it. The plugin is large and tightly coupled to PTYs, so
 * this suite deliberately stays at the edges — connect, broadcast, shut down —
 * rather than pretending to cover the terminal.
 *
 * What it is really pinning is the fan-out contract: `container.ticketBroadcast`
 * is assigned BY this plugin and consumed by the HTTP routes and the domain
 * event listener. If the plugin fails to register, that assignment never
 * happens and every live update in the UI dies silently. Nothing else in the
 * suite would notice.
 */
describe('unified WebSocket', () => {
  let h: TestAppHandle;
  let base: string;
  const sockets: WebSocket[] = [];

  async function connect(): Promise<WebSocket> {
    const ws = await openSocket(`${base}${WS_PATH}`);
    sockets.push(ws);
    return ws;
  }

  beforeEach(async () => {
    h = await createTestApp();
    const address = await h.app.listen({ port: 0, host: '127.0.0.1' });
    base = address.replace('http://', 'ws://');
  });

  afterEach(async () => {
    await Promise.all(sockets.map(closeSocket));
    sockets.length = 0;
    await h.close();
  });

  /**
   * ⚠️  Locked as CURRENT behaviour, not as an endorsement.
   *
   * Unlike `/ws/agents`, this channel performs NO authentication: any client
   * that can reach the port gets every ticket, persona and dashboard update.
   * Under full SSO that is a real exposure, but it is out of scope here —
   * changing it needs a cookie-forwarding design for the upgrade request.
   * Pinning it means the day someone adds auth, this test goes red and the
   * change is deliberate rather than incidental.
   */
  it('accepts a connection with no token at all', async () => {
    const ws = await connect();
    expect(ws.readyState).toBe(ws.OPEN);
  });

  it('delivers a ticket broadcast as a channel-tagged JSON frame', async () => {
    const ws = await connect();
    const received = nextMessage(ws);

    h.container.ticketBroadcast('ticket:updated', { id: 't1', title: 'moved' });

    expect(await received).toEqual({
      channel: 'tickets',
      type: 'ticket:updated',
      data: { id: 't1', title: 'moved' },
    });
  });

  it('fans a broadcast out to every connected client', async () => {
    const first = await connect();
    const second = await connect();
    const onFirst = nextMessage(first);
    const onSecond = nextMessage(second);

    h.container.ticketBroadcast('ticket:created', { id: 't2' });

    expect(await onFirst).toMatchObject({ channel: 'tickets', type: 'ticket:created' });
    expect(await onSecond).toMatchObject({ channel: 'tickets', type: 'ticket:created' });
  });

  it('tags persona broadcasts with their own channel', async () => {
    const ws = await connect();
    const received = nextMessage(ws);

    h.container.personaBroadcast('persona:updated', { name: 'builder' });

    expect(await received).toMatchObject({ channel: 'personas', type: 'persona:updated' });
  });

  it('closes client sockets when the app shuts down', async () => {
    const ws = await connect();
    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));

    await h.close();
    await closed;
    expect(ws.readyState).toBe(ws.CLOSED);
  });
});
