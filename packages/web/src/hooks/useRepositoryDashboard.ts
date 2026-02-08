import { useEffect } from 'react';
import type { RepositoryWsMessage } from '@asm/shared';
import { useRepositoryDashboardStore } from '../stores/repositoryDashboardStore';
import { repositoryWs } from '../services/websocket';
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

    // Subscribe to repository WebSocket updates
    const handleOpen = () => {
      fetchSummaries();
    };

    const handleMessage = (data: ArrayBuffer) => {
      try {
        const text = new TextDecoder().decode(data);
        const msg = JSON.parse(text) as RepositoryWsMessage;
        handleWsMessage(msg);
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
  }, [fetchSummaries, handleWsMessage, setGithubUser]);
}
