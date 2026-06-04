import { describe, it, expect } from 'vitest';
import { __renderers, registerDefaultRenderers } from './renderers';
import { NotificationRendererRegistry } from './registry';
import type { RendererContext } from './types';

const ctx: RendererContext = {
  ticketTitle: (id) => (id === 't1' ? 'Fix the login bug' : null),
  ticketLink: (id, tab) => `/tickets/board/all/ticket/${id}${tab && tab !== 'description' ? `/${tab}` : ''}`,
};

describe('registerDefaultRenderers', () => {
  it('registers exactly the V1 event set (and not raw comment:created)', () => {
    const reg = new NotificationRendererRegistry();
    registerDefaultRenderers(reg);
    expect(reg.types().sort()).toEqual([
      'deliverable:created',
      'deliverable:updated',
      'mention:waiting_for_info',
      'workflow:needs_review',
      'workflow:run_completed',
      'workflow:run_failed',
    ]);
    // Explicit V1 scope decision: raw agent comments are intentionally excluded.
    expect(reg.has('comment:created')).toBe(false);
  });
});

describe('deliverable:created', () => {
  it('flags a draft as an action and links to the deliverables tab', () => {
    const draft = __renderers.renderDeliverableCreated(
      { id: 'd1', ticketId: 't1', agentName: 'The Builder', title: 'Auth spec', status: 'draft' },
      ctx,
    );
    expect(draft).not.toBeNull();
    expect(draft!.level).toBe('action');
    expect(draft!.emoji).toBe('📝');
    expect(draft!.dedupKey).toBe('deliverable-draft:d1');
    expect(draft!.link).toBe('/tickets/board/all/ticket/t1/deliverables');
    // ticket title is woven into the body when resolvable
    expect(draft!.body).toContain('Fix the login bug');
  });

  it('uses the shared "final" dedup key when created directly as final', () => {
    const draft = __renderers.renderDeliverableCreated(
      { id: 'd2', ticketId: 't1', agentName: 'X', title: 'Report', status: 'final' },
      ctx,
    );
    expect(draft!.dedupKey).toBe('deliverable-final:d2');
    expect(draft!.level).toBe('success');
  });

  it('returns null on a malformed payload (missing ids)', () => {
    expect(__renderers.renderDeliverableCreated({ status: 'draft' }, ctx)).toBeNull();
    expect(__renderers.renderDeliverableCreated(null, ctx)).toBeNull();
  });
});

describe('deliverable:updated', () => {
  it('notifies once on finalisation, sharing the created-final key', () => {
    const created = __renderers.renderDeliverableCreated(
      { id: 'd3', ticketId: 't1', title: 'X', status: 'final' },
      ctx,
    );
    const updated = __renderers.renderDeliverableUpdated(
      { id: 'd3', ticketId: 't1', title: 'X', status: 'final' },
      ctx,
    );
    // Same dedup key ⇒ the store will collapse these into a single entry.
    expect(updated!.dedupKey).toBe('deliverable-final:d3');
    expect(updated!.dedupKey).toBe(created!.dedupKey);
  });

  it('skips draft updates (avoids spamming on every edit)', () => {
    expect(
      __renderers.renderDeliverableUpdated(
        { id: 'd4', ticketId: 't1', title: 'X', status: 'draft' },
        ctx,
      ),
    ).toBeNull();
  });
});

describe('workflow renderers', () => {
  it('needs_review is an action keyed by step run, linking to the workflow tab', () => {
    const d = __renderers.renderWorkflowNeedsReview(
      { workflowRunId: 'w1', stepRunId: 's1', stepId: 'review', ticketId: 't1' },
      ctx,
    );
    expect(d!.level).toBe('action');
    expect(d!.dedupKey).toBe('workflow-needs-review:s1');
    expect(d!.link).toBe('/tickets/board/all/ticket/t1/workflow');
  });

  it('run_completed is keyed by run id', () => {
    const d = __renderers.renderWorkflowCompleted({ workflowRunId: 'w2', ticketId: 't1' }, ctx);
    expect(d!.dedupKey).toBe('workflow-completed:w2');
    expect(d!.level).toBe('success');
  });

  it('run_failed surfaces the error message at error level', () => {
    const d = __renderers.renderWorkflowFailed(
      { workflowRunId: 'w3', ticketId: 't1', error: 'boom: step crashed' },
      ctx,
    );
    expect(d!.dedupKey).toBe('workflow-failed:w3');
    expect(d!.level).toBe('error');
    expect(d!.body).toContain('boom');
  });
});

describe('mention:waiting_for_info', () => {
  it('names the waiting agent and links to comments', () => {
    const d = __renderers.renderMentionWaiting(
      { id: 'm1', ticketId: 't1', targetAgent: 'the-builder', status: 'waiting_for_info' },
      ctx,
    );
    expect(d!.level).toBe('action');
    expect(d!.emoji).toBe('❓');
    expect(d!.dedupKey).toBe('mention-waiting:m1');
    expect(d!.body).toContain('the-builder');
    expect(d!.link).toBe('/tickets/board/all/ticket/t1/comments');
  });
});
