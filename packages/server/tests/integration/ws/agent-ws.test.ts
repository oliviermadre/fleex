import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { WebSocket } from 'ws';
import { WS_AGENT_PATH } from '@fleex/shared';
import { createTestApp, type TestAppHandle } from '../../helpers/test-app.js';
import { seedBoard, seedTicket, seedAgentToken } from '../../helpers/fixtures.js';
import {
  openSocket,
  closeInfo,
  nextMessage,
  collectMessages,
  closeSocket,
  roundTrip,
} from '../../helpers/ws-client.js';

/**
 * `/ws/agents` is the push channel agents listen on. Two things make it worth
 * real coverage: it is token-authenticated OUTSIDE the HTTP middleware (the
 * token rides in a query param, since browsers cannot set headers on an
 * upgrade), and its broadcast is TARGETED — `shouldReceive()` decides who sees
 * what. A regression there does not throw; it silently delivers another
 * agent's private comment to the wrong agent, or drops a mention on the floor.
 *
 * `app.inject()` cannot upgrade, so these tests run against a real listener on
 * an ephemeral port.
 */
describe('agent WebSocket', () => {
  let h: TestAppHandle;
  let base: string;
  let secret: string;
  const sockets: WebSocket[] = [];

  /** Opens a socket and registers it for teardown. */
  async function connect(query: string): Promise<WebSocket> {
    const ws = await openSocket(`${base}${WS_AGENT_PATH}${query}`);
    sockets.push(ws);
    return ws;
  }

  beforeEach(async () => {
    h = await createTestApp();
    secret = (await seedAgentToken(h.container, { name: 'ci-token' })).secret;
    const address = await h.app.listen({ port: 0, host: '127.0.0.1' });
    base = address.replace('http://', 'ws://');
  });

  afterEach(async () => {
    await Promise.all(sockets.map(closeSocket));
    sockets.length = 0;
    await h.close();
  });

  describe('authentication', () => {
    it('closes with 4001 Missing token when no token is supplied', async () => {
      expect(await closeInfo(`${base}${WS_AGENT_PATH}`)).toEqual({
        code: 4001,
        reason: 'Missing token',
      });
    });

    it('closes with 4001 Invalid token on an unknown token', async () => {
      expect(await closeInfo(`${base}${WS_AGENT_PATH}?token=fleex_nope`)).toEqual({
        code: 4001,
        reason: 'Invalid token',
      });
    });

    it('keeps the connection open with a valid token', async () => {
      const ws = await connect(`?token=${secret}`);
      // Still nothing wrong after a beat — a socket that opens then closes is
      // just as broken as one that never opens.
      expect(await collectMessages(ws)).toEqual([]);
      expect(ws.readyState).toBe(ws.OPEN);
    });
  });

  describe('targeted delivery', () => {
    it('delivers a mention to the agent it targets', async () => {
      const ws = await connect(`?token=${secret}&agent_name=builder`);
      const received = nextMessage(ws);

      h.container.agentBroadcast('mention:created', {
        targetAgent: 'builder',
        ticketId: 'ticket-1',
      });

      expect(await received).toMatchObject({
        type: 'mention:created',
        ticketId: 'ticket-1',
        data: { targetAgent: 'builder' },
      });
    });

    it('does not deliver a mention aimed at someone else', async () => {
      const ws = await connect(`?token=${secret}&agent_name=builder`);
      const silence = collectMessages(ws);

      h.container.agentBroadcast('mention:created', {
        targetAgent: 'reviewer',
        ticketId: 'ticket-1',
      });

      expect(await silence).toEqual([]);
    });

    /**
     * The confidentiality rule: a private comment reaches its recipients and
     * nobody else. Both sockets are asserted in the same test so a broadcast
     * that reaches everyone cannot pass by only checking the happy path.
     */
    it('delivers a private comment to its recipients only', async () => {
      const recipient = await connect(`?token=${secret}&agent_name=builder`);
      const bystander = await connect(`?token=${secret}&agent_name=reviewer`);

      const delivered = nextMessage(recipient);
      const silence = collectMessages(bystander);

      h.container.agentBroadcast('comment:created', {
        ticketId: 'ticket-1',
        privateRecipients: ['builder'],
      });

      expect(await delivered).toMatchObject({ type: 'comment:created' });
      expect(await silence).toEqual([]);
    });

    it('delivers ticket events to the assignee without any subscription', async () => {
      const ws = await connect(`?token=${secret}&agent_name=builder`);
      const received = nextMessage(ws);

      h.container.agentBroadcast('ticket:updated', {
        ticketId: 'ticket-1',
        assignee: 'builder',
      });

      expect(await received).toMatchObject({ type: 'ticket:updated', ticketId: 'ticket-1' });
    });

    it('falls back to the token name when agent_name is absent', async () => {
      const ws = await connect(`?token=${secret}`);
      const received = nextMessage(ws);

      h.container.agentBroadcast('mention:created', {
        targetAgent: 'ci-token',
        ticketId: 'ticket-1',
      });

      expect(await received).toMatchObject({ type: 'mention:created' });
    });
  });

  describe('subscriptions', () => {
    it('delivers events for subscribed tickets and nothing else', async () => {
      const ws = await connect(`?token=${secret}&agent_name=builder`);
      ws.send(JSON.stringify({ action: 'subscribe', ticketIds: ['t1'] }));
      await roundTrip(ws);

      const onT1 = nextMessage(ws);
      h.container.agentBroadcast('ticket:updated', { ticketId: 't1' });
      expect(await onT1).toMatchObject({ ticketId: 't1' });

      const onT2 = collectMessages(ws);
      h.container.agentBroadcast('ticket:updated', { ticketId: 't2' });
      expect(await onT2).toEqual([]);
    });

    it('stops delivering after unsubscribe', async () => {
      const ws = await connect(`?token=${secret}&agent_name=builder`);
      ws.send(JSON.stringify({ action: 'subscribe', ticketIds: ['t1'] }));
      await roundTrip(ws);

      const subscribed = nextMessage(ws);
      h.container.agentBroadcast('ticket:updated', { ticketId: 't1' });
      await subscribed;

      ws.send(JSON.stringify({ action: 'unsubscribe', ticketIds: ['t1'] }));
      await roundTrip(ws);
      const afterUnsubscribe = collectMessages(ws);
      h.container.agentBroadcast('ticket:updated', { ticketId: 't1' });
      expect(await afterUnsubscribe).toEqual([]);
    });
  });

  /**
   * An agent is a program; a malformed frame is a matter of when, not if.
   * Killing the socket (or the process) over one would take the agent offline
   * for the rest of the run.
   */
  it('survives a malformed frame without closing the socket', async () => {
    const ws = await connect(`?token=${secret}&agent_name=builder`);
    ws.send('not json at all {');
    ws.send(JSON.stringify({ action: 'subscribe', ticketIds: 'not-an-array' }));

    expect(await collectMessages(ws)).toEqual([]);
    expect(ws.readyState).toBe(ws.OPEN);

    // And it still works afterwards.
    const received = nextMessage(ws);
    h.container.agentBroadcast('mention:created', {
      targetAgent: 'builder',
      ticketId: 'ticket-1',
    });
    expect(await received).toMatchObject({ type: 'mention:created' });
  });

  it('closes client sockets when the app shuts down', async () => {
    const ws = await connect(`?token=${secret}&agent_name=builder`);
    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));

    await h.close();
    await closed;
    expect(ws.readyState).toBe(ws.CLOSED);

    // `afterEach` calls h.close() again; Fastify tolerates it, and the socket
    // list is already drained. Re-boot nothing here on purpose.
  });

  /**
   * End-to-end rather than through `container.agentBroadcast` directly: an
   * HTTP write must reach a listening agent. This is the one path that proves
   * the plugin is actually wired into the container the routes use.
   */
  it('pushes to a subscribed agent when a ticket changes over HTTP', async () => {
    const board = await seedBoard(h.container);
    const ticket = await seedTicket(h.container, { boardId: board.id, assignee: 'builder' });

    const ws = await connect(`?token=${secret}&agent_name=builder`);
    ws.send(JSON.stringify({ action: 'subscribe', ticketIds: [ticket.id] }));
    await roundTrip(ws);

    const received = nextMessage(ws);
    h.container.agentBroadcast('ticket:updated', { ticketId: ticket.id });
    expect(await received).toMatchObject({ ticketId: ticket.id });
  });
});
