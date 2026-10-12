import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/application/event-bus.js';
import { DomainEventListener } from '../../src/application/domain-event-listener.js';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';

/** `@skill:cc-…` in a comment runs the Claude Code skill resolved for that ticket. */
function setup(resolved: { id: string } | null, nativeSkill: unknown = null) {
  const bus = new EventBus();
  const mention = TicketMentionEntity.create({ id: 'm1', ticketId: 't1', commentId: 'c1', targetAgent: 'cc-deploy', sourceAgent: 'user', targetType: 'skill' });
  const comment = TicketCommentEntity.create({ id: 'c1', ticketId: 't1', authorType: 'human', authorName: 'Olivier', body: '@skill:cc-deploy  juste staging' });
  const executeAgent = { executeForClaudeCodeSkill: vi.fn().mockResolvedValue(undefined), executeForSkill: vi.fn().mockResolvedValue(undefined) };
  const mentionStore = { getById: vi.fn().mockResolvedValue(mention), save: vi.fn() };
  const claudeCodeSkills = { resolveForTicket: vi.fn().mockResolvedValue(resolved) };
  const listener = new DomainEventListener({
    eventBus: bus,
    skillStore: { getByCommandName: vi.fn().mockResolvedValue(nativeSkill) },
    mentionStore,
    commentStore: { getById: vi.fn().mockResolvedValue(comment) },
    personaStore: { getByName: vi.fn() },
    executeAgent,
    claudeCodeSkills,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as never);
  listener.register();
  const fire = async () => {
    bus.emit({ type: 'mention.created', mentionId: 'm1', ticketId: 't1', targetAgent: 'cc-deploy', targetType: 'skill', sourceAgent: 'user', occurredAt: new Date() });
    await new Promise((r) => setTimeout(r, 10));
  };
  return { fire, executeAgent, mentionStore, claudeCodeSkills, mention };
}

describe('@skill:cc-… mentions', () => {
  it('runs the resolved Claude Code skill with the comment minus the mention as arguments', async () => {
    const { fire, executeAgent, claudeCodeSkills } = setup({ id: 'cc-row' });
    await fire();
    expect(claudeCodeSkills.resolveForTicket).toHaveBeenCalledWith('cc-deploy', 't1');
    expect(executeAgent.executeForClaudeCodeSkill).toHaveBeenCalledWith('cc-row', 't1', { commentBody: 'juste staging', mentionId: 'm1' });
  });

  it('resolves the mention silently when nothing runnable matches (disabled, missing, other machine, out of scope)', async () => {
    const { fire, executeAgent, mention } = setup(null);
    await fire();
    expect(executeAgent.executeForClaudeCodeSkill).not.toHaveBeenCalled();
    expect(mention.status).toBe('resolved');
  });

  it('lets a native skill keep its name: Claude Code skills are not even looked up', async () => {
    const { fire, executeAgent, claudeCodeSkills } = setup({ id: 'cc-row' }, { id: 'native', enabled: true });
    await fire();
    expect(claudeCodeSkills.resolveForTicket).not.toHaveBeenCalled();
    expect(executeAgent.executeForSkill).toHaveBeenCalled();
  });
});
