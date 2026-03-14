import { useEffect } from 'react';
import type { RepositoryWsMessage } from '@fleex/shared';
import { useRepositoryDashboardStore } from '../stores/repositoryDashboardStore';
import { usePullRequestStore } from '../stores/pullRequestStore';
import { repositoryWs } from '../services/websocket';
import * as api from '../services/api';

export function useRepositoryDashboard() {
  const fetchSummaries = useRepositoryDashboardStore((s) => s.fetchSummaries);
  const handleWsMessage = useRepositoryDashboardStore((s) => s.handleWsMessage);
  const setGithubUser = useRepositoryDashboardStore((s) => s.setGithubUser);
  const handlePrWsMessage = usePullRequestStore((s) => s.handleWsMessage);

  useEffect(() => {
    // Fetch initial data
    fetchSummaries();
    api.fetchGitHubUser()
      .then((data) => setGithubUser(data.login))
      .catch(() => {});

    // Fetch initial PR data (subsequent updates arrive via WS)
    usePullRequestStore.getState().refreshAllPulls();

    // Subscribe to repository WebSocket updates
    const handleOpen = () => {
      fetchSummaries();
      // Re-fetch PRs on reconnect
      usePullRequestStore.getState().refreshAllPulls();
    };

    const handleMessage = (data: ArrayBuffer) => {
      try {
        const text = new TextDecoder().decode(data);
        const msg = JSON.parse(text) as RepositoryWsMessage;
        handleWsMessage(msg);
        // Forward PR updates to the pull request store
        handlePrWsMessage(msg);
      } catch {
        // Not a valid JSON text frame, ignore
      }
    };

    const unsubOpen = repositoryWs.onOpen(handleOpen);
    const unsubMessage = repositoryWs.onMessage(handleMessage);

    return () => {
      unsubOpen();
      unsubMessage();
    };
  }, [fetchSummaries, handleWsMessage, setGithubUser, handlePrWsMessage]);
}
