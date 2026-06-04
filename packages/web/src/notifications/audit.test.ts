import { describe, it, expect } from 'vitest';
import type { DomainEventLog } from '@fleex/shared';
import {
  auditEntryToWsMessage,
  pulseEventPrefixes,
  reconstructNotifications,
} from './audit';
import { NotificationRendererRegistry } from './registry';
import { registerDefaultRenderers } from './renderers';
import type { RendererContext } from './types';

const ctx: RendererContext = {
  ticketLink: (id, tab) =>
    `/tickets/board/all/ticket/${id}${tab && tab !== 'description' ? `/${tab}` : ''}`,
};

function entry(
  eventType: string,
  payload: Record<string, unknown>,
  occurredAt = '2026-06-04T00:00:00.000Z',
  id = `log-${Math.random()}`,
): DomainEventLog {
  return { id, eventType, payload, instanceId: 'host:3000', occurredAt };
}

describe('auditEntryToWsMessage', () => {
  it('maps deliverable.created → deliverable:created and renames deliverableId → id', () => {
    const msg = auditEntryToWsMessage(
      entry('deliverable.created', {
        deliverableId: 'd1',
        ticketId: 't1',
        agentName: 'The Builder',
        status: 'draft',
        title: 'Auth spec',
      }),
    );
    expect(msg).toEqual({
      type: 'deliverable:created',
      data: { id: 'd1', ticketId: 't1', agentName: 'The Builder', status: 'draft', title: 'Auth spec' },
    });
  });

  it('maps deliverable.updated and surfaces newStatus as the renderer-facing status', () => {
    const msg = auditEntryToWsMessage(
      entry('deliverable.updated', {
        deliverableId: 'd2',
        ticketId: 't1',
        agentName: 'X',
        oldStatus: 'draft',
        newStatus: 'final',
        title: 'Report',
      }),
    );
    expect(msg).toEqual({
      type: 'deliverable:updated',
      data: { id: 'd2', ticketId: 't1', agentName: 'X', status: 'final', title: 'Report' },
    });
  });

  it('maps mention.waiting_for_info and renames mentionId → id', () => {
    const msg = auditEntryToWsMessage(
      entry('mention.waiting_for_info', { mentionId: 'm1', ticketId: 't1', targetAgent: 'the-builder' }),
    );
    expect(msg).toEqual({
      type: 'mention:waiting_for_info',
      data: { id: 'm1', ticketId: 't1', targetAgent: 'the-builder' },
    });
  });

  it('passes workflow payloads through unchanged (fields already match 1:1)', () => {
    const payload = { workflowRunId: 'w3', stepRunId: 's3', stepId: 'review', ticketId: 't1', error: 'boom' };
    expect(auditEntryToWsMessage(entry('workflow.run_failed', payload))).toEqual({
      type: 'workflow:run_failed',
      data: payload,
    });
    expect(auditEntryToWsMessage(entry('workflow.needs_review', payload))?.type).toBe('workflow:needs_review');
    expect(auditEntryToWsMessage(entry('workflow.run_completed', payload))?.type).toBe('workflow:run_completed');
  });

  it('returns null for non-Pulse event types (e.g. step noise, deletes, comments)', () => {
    expect(auditEntryToWsMessage(entry('workflow.step_started', {}))).toBeNull();
    expect(auditEntryToWsMessage(entry('deliverable.deleted', {}))).toBeNull();
    expect(auditEntryToWsMessage(entry('comment.posted', {}))).toBeNull();
    expect(auditEntryToWsMessage(entry('mention.created', {}))).toBeNull();
  });
});

describe('pulseEventPrefixes', () => {
  it('derives the unique event roots from the registered renderers', () => {
    const reg = new NotificationRendererRegistry();
    registerDefaultRenderers(reg);
    expect(pulseEventPrefixes(reg).sort()).toEqual(['deliverable', 'mention', 'workflow']);
  });
});

describe('reconstructNotifications', () => {
  const reg = new NotificationRendererRegistry();
  registerDefaultRenderers(reg);

  it('stamps each notification with the event occurredAt (not "now")', () => {
    const out = reconstructNotifications(
      [entry('deliverable.created', { deliverableId: 'd1', ticketId: 't1', status: 'final', title: 'R' }, '2020-01-02T03:04:05.000Z')],
      reg,
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.createdAt).toBe('2020-01-02T03:04:05.000Z');
    expect(out[0]!.id).toBe('deliverable-final:d1');
  });

  it('skips entries with no renderer / opted-out renderers (noise is dropped)', () => {
    const out = reconstructNotifications(
      [
        entry('workflow.step_started', { workflowRunId: 'w', ticketId: 't1' }),
        entry('deliverable.updated', { deliverableId: 'd9', ticketId: 't1', newStatus: 'draft', title: 'X' }), // draft update → renderer opts out
      ],
      reg,
      ctx,
    );
    expect(out).toHaveLength(0);
  });

  it('deduplicates by notification id, keeping the newest occurrence', () => {
    const out = reconstructNotifications(
      [
        entry('deliverable.created', { deliverableId: 'd1', ticketId: 't1', status: 'final', title: 'old' }, '2026-06-01T00:00:00.000Z'),
        entry('deliverable.updated', { deliverableId: 'd1', ticketId: 't1', newStatus: 'final', title: 'new' }, '2026-06-02T00:00:00.000Z'),
      ],
      reg,
      ctx,
    );
    // both produce dedup key `deliverable-final:d1` → collapse to one, newest wins
    expect(out).toHaveLength(1);
    expect(out[0]!.createdAt).toBe('2026-06-02T00:00:00.000Z');
  });

  it('sorts newest-first and caps to the requested max', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry(
        'workflow.run_completed',
        { workflowRunId: `w${i}`, ticketId: 't1' },
        `2026-06-0${i + 1}T00:00:00.000Z`,
      ),
    );
    const out = reconstructNotifications(entries, reg, ctx, 3);
    expect(out).toHaveLength(3);
    expect(out.map((n) => n.createdAt)).toEqual([
      '2026-06-05T00:00:00.000Z',
      '2026-06-04T00:00:00.000Z',
      '2026-06-03T00:00:00.000Z',
    ]);
  });
});
