import { create } from 'zustand';
import { fetchGateways, deleteGateway, type GatewayInfo } from '../services/api';

interface GatewayState {
  gateways: GatewayInfo[];
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useGatewayStore = create<GatewayState>((set, get) => ({
  gateways: [],
  loaded: false,
  loading: false,

  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const gateways = await fetchGateways();
      set({ gateways, loaded: true, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  remove: async (id: string) => {
    await deleteGateway(id);
    await get().load();
  },
}));
