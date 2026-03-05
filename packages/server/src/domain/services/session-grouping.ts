import type { SessionGroup, WorktreeSessionGroup } from '@fleex/shared';
import type { SessionEntity } from '../entities.js';

export class SessionGroupingService {
  groupSessions(sessions: SessionEntity[]): SessionGroup[] {
    const repoMap = new Map<string, Map<string, SessionEntity[]>>();

    for (const session of sessions) {
      const org = session.repositoryOrg ?? '_ungrouped';
      const name = session.repositoryName ?? '_ungrouped';
      const repoKey = `${org}/${name}`;
      const branch = session.worktreeBranch ?? '_default';

      let branchMap = repoMap.get(repoKey);
      if (!branchMap) {
        branchMap = new Map();
        repoMap.set(repoKey, branchMap);
      }

      let branchSessions = branchMap.get(branch);
      if (!branchSessions) {
        branchSessions = [];
        branchMap.set(branch, branchSessions);
      }

      branchSessions.push(session);
    }

    const groups: SessionGroup[] = [];

    for (const [repoKey, branchMap] of repoMap) {
      const [org, name] = repoKey.split('/') as [string, string];
      const worktrees: WorktreeSessionGroup[] = [];

      for (const [branch, branchSessions] of branchMap) {
        worktrees.push({
          branch,
          path: branchSessions[0]?.cwd ?? '',
          sessions: branchSessions.map((s) => s.toDTO()),
        });
      }

      groups.push({
        repositoryOrg: org,
        repositoryName: name,
        worktrees,
      });
    }

    return groups;
  }
}
