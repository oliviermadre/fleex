import { useEffect } from 'react';
import { WS_TERMINAL_PATH, WS_DASHBOARD_PATH, WS_REPOSITORY_PATH, WS_TICKET_PATH } from '@asm/shared';
import { terminalWs, dashboardWs, repositoryWs, ticketWs } from '../services/websocket';
import { WS_BASE_URL } from '../lib/constants';

export function useWebSocket() {
  useEffect(() => {
    terminalWs.connect(`${WS_BASE_URL}${WS_TERMINAL_PATH}`);
    dashboardWs.connect(`${WS_BASE_URL}${WS_DASHBOARD_PATH}`);
    repositoryWs.connect(`${WS_BASE_URL}${WS_REPOSITORY_PATH}`);
    ticketWs.connect(`${WS_BASE_URL}${WS_TICKET_PATH}`);

    return () => {
      terminalWs.disconnect();
      dashboardWs.disconnect();
      repositoryWs.disconnect();
      ticketWs.disconnect();
    };
  }, []);
}
