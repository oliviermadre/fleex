import { describe, it, expect } from 'vitest';
import type { Skill } from '@fleex/shared';
import { claudeCodeSkillsInScope, ticketRepos } from './claude-code-skills';

const cc = (over: Partial<Skill>): Skill => ({
  id: 'x', commandName: 'cc-deploy', name: 'deploy', displayName: 'deploy', markdownContent: '', enabled: true,
  personaId: 'p', createdAt: '', updatedAt: '', source: 'claude_code', ccOrigin: 'user', repo: null, ...over,
});

describe('claudeCodeSkillsInScope', () => {
  const user = cc({ id: 'u' });
  const project = cc({ id: 'p', ccOrigin: 'project', repo: 'Evaneos/Fleex' });
  const plugin = cc({ id: 'pl', commandName: 'cc-sp--brainstorm', ccOrigin: 'plugin' });

  it('applies the server rule: project beats user in its repo, user elsewhere', () => {
    expect(claudeCodeSkillsInScope([user, project, plugin], ['evaneos/fleex']).map((s) => s.id)).toEqual(['p', 'pl']);
    expect(claudeCodeSkillsInScope([user, project, plugin], []).map((s) => s.id)).toEqual(['u', 'pl']);
  });

  it('without ticket context keeps one entry per mention name', () => {
    expect(claudeCodeSkillsInScope([user, project], null)).toHaveLength(1);
  });

  it('extracts linked repositories only', () => {
    expect(ticketRepos([{ type: 'repository', ref: 'Org/Name' }, { type: 'worktree', ref: 'org/x:b' }])).toEqual(['org/name']);
  });
});
