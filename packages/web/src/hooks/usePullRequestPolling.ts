import { useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { usePullRequestStore } from '../stores/pullRequestStore';

const POLL_INTERVAL_MS = 30_000;

export function usePullRequestPolling() {
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const fetchPullsForRepo = usePullRequestStore((s) => s.fetchPullsForRepo);
  const sessionGroupsRef = useRef(sessionGroups);
  sessionGroupsRef.current = sessionGroups;

  useEffect(() => {
    function fetchAll() {
      const seen = new Set<string>();
      for (const group of sessionGroupsRef.current) {
        if (!group.repositoryOrg || !group.repositoryName || group.repositoryOrg.startsWith('_')) continue;
        const key = `${group.repositoryOrg}/${group.repositoryName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fetchPullsForRepo(group.repositoryOrg, group.repositoryName);
      }
    }

    fetchAll();

    const interval = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchPullsForRepo]);
}
