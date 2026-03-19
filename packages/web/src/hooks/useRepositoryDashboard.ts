import { useEffect } from 'react';
import type { RepositoryWsMessage } from '@fleex/shared';
import { useRepositoryDashboardStore } from '../stores/repositoryDashboardStore';
import { appWs } from '../services/websocket';
import * as api from '../services/api';

export function useRepositoryDashboard() {
  const fetchSummaries = useRepositoryDashboardStore((s) => s.fetchSummaries);
  const handleWsMessage = useRepositoryDashboardStore((s) => s.handleWsMessage);
  const setGithubUser = useRepositoryDashboardStore((s) => s.setGithubUser);

  useEffect(() => {
    // Fetch initial data
    fetchSummaries();
    api.fetchGitHubUser()
      .then((data) => setGithubUser(data.login))
      .catch(() => {});

    const handleOpen = () => {
      fetchSummaries();
    };

    const unsubOpen = appWs.onOpen(handleOpen);
    const unsubChannel = appWs.onChannel('repositories', (msg) => {
      handleWsMessage(msg as RepositoryWsMessage);
    });

    return () => {
      unsubOpen();
      unsubChannel();
    };
  }, [fetchSummaries, handleWsMessage, setGithubUser]);
}
