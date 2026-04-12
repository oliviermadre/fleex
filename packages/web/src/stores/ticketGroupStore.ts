import { create } from 'zustand';
import type {
  TicketGroup,
  TicketGroupMembership,
  TicketRelationship,
  CreateTicketGroupRequest,
  UpdateTicketGroupRequest,
  TicketGroupWsMessage,
  Ticket,
} from '@fleex/shared';
import * as api from '../services/api';

export type EpicDetailTab = 'description' | 'tickets' | 'deliverables' | 'activity';
export const VALID_EPIC_DETAIL_TABS: EpicDetailTab[] = ['description', 'tickets', 'deliverables', 'activity'];

interface TicketGroupState {
  // ── Data ──
  groups: TicketGroup[];
  memberships: TicketGroupMembership[];
  relationships: TicketRelationship[];
  /** Cache: groupId → ticket IDs */
  groupTicketIds: Record<string, string[]>;
  /** Cache: ticketId → groupIds */
  ticketGroupIds: Record<string, string[]>;
  /** Cache: parentId → childIds */
  childrenMap: Record<string, string[]>;

  // ── UI ──
  selectedEpicIds: string[];
  activeView: 'board' | 'roadmap';
  selectedEpicDetailId: string | null;
  epicDetailTab: EpicDetailTab;

  // ── Actions ──
  fetchGroups: (boardId?: string) => Promise<void>;
  fetchGroupTickets: (groupId: string) => Promise<Ticket[]>;
  createGroup: (req: CreateTicketGroupRequest) => Promise<TicketGroup>;
  updateGroup: (id: string, req: UpdateTicketGroupRequest) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  archiveGroup: (id: string) => Promise<void>;
  unarchiveGroup: (id: string) => Promise<void>;

  fetchTicketMemberships: (ticketId: string) => Promise<void>;
  addTicketToGroup: (groupId: string, ticketId: string) => Promise<void>;
  removeTicketFromGroup: (groupId: string, ticketId: string) => Promise<void>;

  addBoardToGroup: (groupId: string, boardId: string) => Promise<void>;
  removeBoardFromGroup: (groupId: string, boardId: string) => Promise<void>;

  fetchChildrenForTicket: (ticketId: string) => Promise<Ticket[]>;
  addChild: (parentId: string, childId: string) => Promise<void>;
  removeChild: (parentId: string, childId: string) => Promise<void>;

  // ── UI Actions ──
  toggleEpicFilter: (epicId: string) => void;
  clearEpicFilter: () => void;
  setActiveView: (view: 'board' | 'roadmap') => void;
  setSelectedEpicDetail: (id: string | null) => void;
  setEpicDetailTab: (tab: EpicDetailTab) => void;

  // ── WebSocket ──
  handleWsMessage: (msg: TicketGroupWsMessage) => void;
}

export const useTicketGroupStore = create<TicketGroupState>((set, get) => ({
  groups: [],
  memberships: [],
  relationships: [],
  groupTicketIds: {},
  ticketGroupIds: {},
  childrenMap: {},
  selectedEpicIds: [],
  activeView: 'board',
  epicDetailTab: 'description',
  selectedEpicDetailId: null,

  fetchGroups: async (boardId?: string) => {
    const groups = await api.fetchTicketGroups(boardId);
    set({ groups });
  },

  fetchGroupTickets: async (groupId: string) => {
    const tickets = await api.fetchTicketGroupTickets(groupId);
    set((s) => {
      const ticketIds = tickets.map((t) => t.id);
      // Also build the reverse mapping: ticketId → groupIds
      const updatedTicketGroupIds = { ...s.ticketGroupIds };
      for (const tid of ticketIds) {
        updatedTicketGroupIds[tid] = [...new Set([...(updatedTicketGroupIds[tid] ?? []), groupId])];
      }
      return {
        groupTicketIds: { ...s.groupTicketIds, [groupId]: ticketIds },
        ticketGroupIds: updatedTicketGroupIds,
      };
    });
    return tickets;
  },

  createGroup: async (req) => {
    const group = await api.createTicketGroup(req);
    set((s) => {
      if (s.groups.some((g) => g.id === group.id)) return s;
      return { groups: [...s.groups, group] };
    });
    return group;
  },

  updateGroup: async (id, req) => {
    const updated = await api.updateTicketGroup(id, req);
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? updated : g)),
    }));
  },

  deleteGroup: async (id) => {
    await api.deleteTicketGroup(id);
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id),
      groupTicketIds: Object.fromEntries(
        Object.entries(s.groupTicketIds).filter(([k]) => k !== id),
      ),
    }));
  },

  archiveGroup: async (id) => {
    const updated = await api.archiveTicketGroup(id);
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? updated : g)),
    }));
  },

  unarchiveGroup: async (id) => {
    const updated = await api.unarchiveTicketGroup(id);
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? updated : g)),
    }));
  },

  fetchTicketMemberships: async (ticketId) => {
    const groups = await api.fetchTicketGroups4Ticket(ticketId);
    set((s) => ({
      ticketGroupIds: {
        ...s.ticketGroupIds,
        [ticketId]: groups.map((g) => g.id),
      },
    }));
  },

  addTicketToGroup: async (groupId, ticketId) => {
    await api.addTicketToGroup(groupId, ticketId);
    set((s) => ({
      memberships: [...s.memberships, { ticketId, groupId }],
      groupTicketIds: {
        ...s.groupTicketIds,
        [groupId]: [...new Set([...(s.groupTicketIds[groupId] ?? []), ticketId])],
      },
      ticketGroupIds: {
        ...s.ticketGroupIds,
        [ticketId]: [...new Set([...(s.ticketGroupIds[ticketId] ?? []), groupId])],
      },
    }));
  },

  removeTicketFromGroup: async (groupId, ticketId) => {
    await api.removeTicketFromGroup(groupId, ticketId);
    set((s) => ({
      memberships: s.memberships.filter((m) => !(m.ticketId === ticketId && m.groupId === groupId)),
      groupTicketIds: {
        ...s.groupTicketIds,
        [groupId]: (s.groupTicketIds[groupId] ?? []).filter((id) => id !== ticketId),
      },
      ticketGroupIds: {
        ...s.ticketGroupIds,
        [ticketId]: (s.ticketGroupIds[ticketId] ?? []).filter((id) => id !== groupId),
      },
    }));
  },

  addBoardToGroup: async (groupId, boardId) => {
    await api.addBoardToTicketGroup(groupId, boardId);
    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === groupId
          ? { ...g, boardIds: [...new Set([...g.boardIds, boardId])] }
          : g,
      ),
    }));
  },

  removeBoardFromGroup: async (groupId, boardId) => {
    await api.removeBoardFromTicketGroup(groupId, boardId);
    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === groupId
          ? { ...g, boardIds: g.boardIds.filter((id) => id !== boardId) }
          : g,
      ),
    }));
  },

  fetchChildrenForTicket: async (ticketId) => {
    const children = await api.fetchTicketChildren(ticketId);
    set((s) => ({
      childrenMap: {
        ...s.childrenMap,
        [ticketId]: children.map((c) => c.id),
      },
    }));
    return children;
  },

  addChild: async (parentId, childId) => {
    await api.addTicketChild(parentId, childId);
    set((s) => ({
      relationships: [...s.relationships, { parentId, childId }],
      childrenMap: {
        ...s.childrenMap,
        [parentId]: [...(s.childrenMap[parentId] ?? []), childId],
      },
    }));
  },

  removeChild: async (parentId, childId) => {
    await api.removeTicketChild(parentId, childId);
    set((s) => ({
      relationships: s.relationships.filter((r) => !(r.parentId === parentId && r.childId === childId)),
      childrenMap: {
        ...s.childrenMap,
        [parentId]: (s.childrenMap[parentId] ?? []).filter((id) => id !== childId),
      },
    }));
  },

  toggleEpicFilter: (epicId) => {
    set((s) => {
      const selected = s.selectedEpicIds.includes(epicId)
        ? s.selectedEpicIds.filter((id) => id !== epicId)
        : [...s.selectedEpicIds, epicId];
      return { selectedEpicIds: selected };
    });
  },

  clearEpicFilter: () => set({ selectedEpicIds: [] }),

  setActiveView: (view) => set({ activeView: view }),

  setSelectedEpicDetail: (id) => set({ selectedEpicDetailId: id, epicDetailTab: 'description' }),

  setEpicDetailTab: (tab) => set({ epicDetailTab: tab }),

  handleWsMessage: (msg) => {
    switch (msg.type) {
      case 'ticketGroup:created': {
        const group = msg.data as TicketGroup;
        set((s) => {
          if (s.groups.some((g) => g.id === group.id)) return s;
          return { groups: [...s.groups, group] };
        });
        break;
      }
      case 'ticketGroup:updated': {
        const group = msg.data as TicketGroup;
        set((s) => ({
          groups: s.groups.map((g) => (g.id === group.id ? group : g)),
        }));
        break;
      }
      case 'ticketGroup:deleted': {
        const { id } = msg.data as { id: string };
        set((s) => ({
          groups: s.groups.filter((g) => g.id !== id),
        }));
        break;
      }
      case 'ticketGroup:memberAdded': {
        const { groupId, ticketId } = msg.data as { groupId: string; ticketId: string };
        set((s) => ({
          groupTicketIds: {
            ...s.groupTicketIds,
            [groupId]: [...new Set([...(s.groupTicketIds[groupId] ?? []), ticketId])],
          },
          ticketGroupIds: {
            ...s.ticketGroupIds,
            [ticketId]: [...new Set([...(s.ticketGroupIds[ticketId] ?? []), groupId])],
          },
        }));
        break;
      }
      case 'ticketGroup:memberRemoved': {
        const { groupId, ticketId } = msg.data as { groupId: string; ticketId: string };
        set((s) => ({
          groupTicketIds: {
            ...s.groupTicketIds,
            [groupId]: (s.groupTicketIds[groupId] ?? []).filter((id) => id !== ticketId),
          },
          ticketGroupIds: {
            ...s.ticketGroupIds,
            [ticketId]: (s.ticketGroupIds[ticketId] ?? []).filter((id) => id !== groupId),
          },
        }));
        break;
      }
      case 'ticketGroup:boardAdded': {
        const { groupId, boardId } = msg.data as { groupId: string; boardId: string };
        set((s) => ({
          groups: s.groups.map((g) =>
            g.id === groupId
              ? { ...g, boardIds: [...new Set([...g.boardIds, boardId])] }
              : g,
          ),
        }));
        break;
      }
      case 'ticketGroup:boardRemoved': {
        const { groupId, boardId } = msg.data as { groupId: string; boardId: string };
        set((s) => ({
          groups: s.groups.map((g) =>
            g.id === groupId
              ? { ...g, boardIds: g.boardIds.filter((id) => id !== boardId) }
              : g,
          ),
        }));
        break;
      }
      case 'ticketRelationship:created': {
        const { parentId, childId } = msg.data as { parentId: string; childId: string };
        set((s) => ({
          childrenMap: {
            ...s.childrenMap,
            [parentId]: [...new Set([...(s.childrenMap[parentId] ?? []), childId])],
          },
        }));
        break;
      }
      case 'ticketRelationship:deleted': {
        const { parentId, childId } = msg.data as { parentId: string; childId: string };
        set((s) => ({
          childrenMap: {
            ...s.childrenMap,
            [parentId]: (s.childrenMap[parentId] ?? []).filter((id) => id !== childId),
          },
        }));
        break;
      }
    }
  },
}));
