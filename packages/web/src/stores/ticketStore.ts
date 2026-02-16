import { create } from 'zustand';
import type { Board, BoardWithCounts, Ticket, TicketStatus, TicketPriority, CreateTicketRequest, UpdateTicketRequest, CreateBoardRequest, UpdateBoardRequest, TicketWsMessage } from '@asm/shared';
import { TICKET_STATUSES } from '@asm/shared';
import * as api from '../services/api';

interface TicketFilters {
  repo: string | null;        // "org/name" or null for all
  priority: TicketPriority | null;
  hasSession: boolean | null;  // true=with session, false=without, null=any
  tag: string | null;
}

interface TicketState {
  boards: BoardWithCounts[];
  tickets: Ticket[];
  selectedBoardId: string | null;
  selectedTicketId: string | null;
  statusFilter: TicketStatus | 'all';
  searchQuery: string;
  filters: TicketFilters;

  // Actions
  fetchBoards: () => Promise<void>;
  fetchTickets: (boardId?: string) => Promise<void>;
  createBoard: (req: CreateBoardRequest) => Promise<void>;
  updateBoard: (id: string, req: UpdateBoardRequest) => Promise<void>;
  deleteBoard: (id: string) => Promise<void>;
  createTicket: (req: CreateTicketRequest) => Promise<Ticket>;
  updateTicket: (id: string, req: UpdateTicketRequest) => Promise<void>;
  deleteTicket: (id: string) => Promise<void>;
  moveTicket: (id: string, status: TicketStatus, position?: number) => Promise<void>;
  addLink: (ticketId: string, link: { type: string; ref: string; label: string; url?: string }) => Promise<void>;
  removeLink: (ticketId: string, linkId: string) => Promise<void>;
  openSessionFromTicket: (id: string) => Promise<{ sessionId: string }>;
  selectBoard: (id: string | null) => void;
  selectTicket: (id: string | null) => void;
  setStatusFilter: (filter: TicketStatus | 'all') => void;
  setSearchQuery: (query: string) => void;
  setFilters: (filters: Partial<TicketFilters>) => void;
  clearFilters: () => void;

  // Derived
  ticketsByColumn: (boardId: string | null) => Record<TicketStatus, Ticket[]>;

  // WebSocket
  handleWsMessage: (msg: TicketWsMessage) => void;
}

export const useTicketStore = create<TicketState>((set, get) => ({
  boards: [],
  tickets: [],
  selectedBoardId: null,
  selectedTicketId: null,
  statusFilter: 'all',
  searchQuery: '',
  filters: { repo: null, priority: null, hasSession: null, tag: null },

  fetchBoards: async () => {
    const boards = await api.fetchBoards();
    set({ boards });
    // Auto-select first board if none selected
    if (!get().selectedBoardId && boards.length > 0) {
      set({ selectedBoardId: boards[0]!.id });
    }
  },

  fetchTickets: async (boardId) => {
    const id = boardId ?? get().selectedBoardId;
    // When null (all boards), fetch without filter
    const tickets = await api.fetchTickets(id ?? undefined);
    set({ tickets });
  },

  createBoard: async (req) => {
    await api.createBoard(req);
    await get().fetchBoards();
  },

  updateBoard: async (id, req) => {
    await api.updateBoard(id, req);
    await get().fetchBoards();
  },

  deleteBoard: async (id) => {
    await api.deleteBoard(id);
    const remaining = get().boards.filter((b) => b.id !== id);
    set({ boards: remaining });
    if (get().selectedBoardId === id) {
      set({ selectedBoardId: remaining[0]?.id ?? null });
    }
    await get().fetchBoards();
  },

  createTicket: async (req) => {
    const ticket = await api.createTicket(req);
    set((s) => {
      if (s.tickets.some((t) => t.id === ticket.id)) return s;
      return { tickets: [...s.tickets, ticket] };
    });
    return ticket;
  },

  updateTicket: async (id, req) => {
    const updated = await api.updateTicket(id, req);
    set((s) => ({
      tickets: s.tickets.map((t) => (t.id === id ? updated : t)),
    }));
  },

  deleteTicket: async (id) => {
    await api.deleteTicket(id);
    set((s) => ({
      tickets: s.tickets.filter((t) => t.id !== id),
      selectedTicketId: s.selectedTicketId === id ? null : s.selectedTicketId,
    }));
  },

  moveTicket: async (id, status, position) => {
    const updated = await api.moveTicket(id, status, position);
    set((s) => ({
      tickets: s.tickets.map((t) => (t.id === id ? updated : t)),
    }));
  },

  addLink: async (ticketId, link) => {
    await api.addTicketLink(ticketId, link);
    // Refetch the ticket to get the updated links array
    const updated = await api.fetchTicket(ticketId);
    set((s) => ({
      tickets: s.tickets.map((t) => (t.id === ticketId ? updated : t)),
    }));
  },

  removeLink: async (ticketId, linkId) => {
    await api.removeTicketLink(ticketId, linkId);
    set((s) => ({
      tickets: s.tickets.map((t) =>
        t.id === ticketId ? { ...t, links: t.links.filter((l) => l.id !== linkId) } : t,
      ),
    }));
  },

  openSessionFromTicket: async (id) => {
    return api.openSessionFromTicket(id);
  },

  selectBoard: (id) => {
    set({ selectedBoardId: id, selectedTicketId: null });
    // Refetch tickets for the new board (or all)
    get().fetchTickets(id ?? undefined);
  },
  selectTicket: (id) => set({ selectedTicketId: id }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilters: (partial) => set((s) => ({ filters: { ...s.filters, ...partial } })),
  clearFilters: () => set({ filters: { repo: null, priority: null, hasSession: null, tag: null } }),

  ticketsByColumn: (boardId) => {
    const { tickets, searchQuery, filters } = get();
    let filtered = boardId ? tickets.filter((t) => t.boardId === boardId) : tickets;

    // Text search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    // Repository filter
    if (filters.repo) {
      const repoKey = filters.repo;
      filtered = filtered.filter((t) =>
        t.links.some((l) =>
          (l.type === 'worktree' && l.ref.startsWith(repoKey + ':')) ||
          (l.type === 'repository' && l.ref === repoKey),
        ),
      );
    }

    // Priority filter
    if (filters.priority) {
      filtered = filtered.filter((t) => t.priority === filters.priority);
    }

    // Has session filter
    if (filters.hasSession !== null) {
      filtered = filtered.filter((t) => {
        const has = t.links.some((l) => l.type === 'session');
        return filters.hasSession ? has : !has;
      });
    }

    // Tag filter
    if (filters.tag) {
      const tag = filters.tag;
      filtered = filtered.filter((t) => t.tags.includes(tag));
    }

    const columns = {} as Record<TicketStatus, Ticket[]>;
    for (const s of TICKET_STATUSES) {
      columns[s] = filtered
        .filter((t) => t.status === s)
        .sort((a, b) => a.position - b.position);
    }
    return columns;
  },

  handleWsMessage: (msg) => {
    switch (msg.type) {
      case 'ticket:created': {
        const ticket = msg.data as Ticket;
        set((s) => {
          if (s.tickets.some((t) => t.id === ticket.id)) return s;
          return { tickets: [...s.tickets, ticket] };
        });
        break;
      }
      case 'ticket:updated':
      case 'ticket:moved': {
        const ticket = msg.data as Ticket;
        set((s) => ({
          tickets: s.tickets.map((t) => (t.id === ticket.id ? ticket : t)),
        }));
        break;
      }
      case 'ticket:deleted': {
        const { id } = msg.data as { id: string };
        set((s) => ({
          tickets: s.tickets.filter((t) => t.id !== id),
          selectedTicketId: s.selectedTicketId === id ? null : s.selectedTicketId,
        }));
        break;
      }
      case 'board:updated': {
        get().fetchBoards();
        break;
      }
    }
  },
}));
