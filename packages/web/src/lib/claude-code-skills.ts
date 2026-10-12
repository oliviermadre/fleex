import type { ClaudeCodeSkillOrigin, Skill } from '@fleex/shared';

const ORIGIN_PRIORITY: Record<ClaudeCodeSkillOrigin, number> = { project: 0, user: 1, plugin: 2, synced: 3 };

/** `org/name` of the repositories linked to a ticket. */
export function ticketRepos(links: readonly { type: string; ref: string }[] | undefined): string[] {
  return (links ?? []).filter((l) => l.type === 'repository').map((l) => l.ref.toLowerCase());
}

/**
 * Claude Code skills offered on a ticket — mirrors the server's resolution:
 * a `project` skill only on tickets linked to its repo, and when a user and a
 * project skill share a name, the project one wins. `repos === null` means no
 * ticket context (e.g. a global composer): project skills are kept, deduped.
 */
export function claudeCodeSkillsInScope(skills: readonly Skill[], repos: readonly string[] | null): Skill[] {
  const byCommand = new Map<string, Skill>();
  for (const s of skills) {
    if (!s.enabled) continue;
    if (repos && s.ccOrigin === 'project' && !(s.repo && repos.includes(s.repo.toLowerCase()))) continue;
    const prev = byCommand.get(s.commandName);
    const rank = (x: Skill) => ORIGIN_PRIORITY[x.ccOrigin ?? 'synced'];
    if (!prev || rank(s) < rank(prev)) byCommand.set(s.commandName, s);
  }
  return [...byCommand.values()];
}

export function claudeCodeSkillTooltip(s: Skill): string {
  return [`cc:${s.ccOrigin}`, s.repo, s.sourcePath].filter(Boolean).join(' · ');
}
