import { create } from 'zustand';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface TerminalState {
  connectionStatus: Record<string, ConnectionStatus>;
  setConnectionStatus: (sessionId: string, status: ConnectionStatus) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  connectionStatus: {},

  setConnectionStatus: (sessionId, status) =>
    set((state) => ({
      connectionStatus: { ...state.connectionStatus, [sessionId]: status },
    })),
}));
