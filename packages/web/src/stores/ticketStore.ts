import { create } from 'zustand';
import type { Board, BoardWithCounts, Ticket, TicketLink, TicketStatus, TicketPriority, TicketType, CreateTicketRequest, UpdateTicketRequest, CreateBoardRequest, UpdateBoardRequest, TicketWsMessage } from '@fleex/shared';
import { Status, statusAnchors, getActiveStatusModel } from '@fleex/shared';
import * as api from '../services/api';
import { useSessionStore } from './sessionStore';

export type TicketTab = 'description' | 'comments' | 'mentions' | 'deliverables' | 'activity' | 'workflow';
export const VALID_TICKET_TABS: TicketTab[] = ['description', 'comments', 'mentions', 'deliverables', 'activity', 'workflow'];

interface TicketFilters {
  repo: string | null;        // "org/name" or null for all
  priority: TicketPriority | null;
  type: TicketType | null;
  hasSession: boolean | null;  // true=with session, false=without, null=any
  tag: string | null;
  favorite: boolean | null;
  hideOldDoneCancelled: boolean;
}

interface TicketState {
  boards: BoardWithCounts[];
  tickets: Ticket[];
  selectedBoardId: string | null;
  selectedTicketId: string | null;
  ticketTab: TicketTab;
  statusFilter: TicketStatus | 'all';
  searchQuery: string;
  filters: TicketFilters;

  // Actions
  fetchBoards: () => Promise<void>;
  fetchTickets: () => Promise<void>;
  createBoard: (req: CreateBoardRequest) => Promise<void>;
  updateBoard: (id: string, req: UpdateBoardRequest) => Promise<void>;
  deleteBoard: (id: string) => Promise<void>;
  createTicket: (req: CreateTicketRequest) => Promise<Ticket>;
  updateTicket: (id: string, req: UpdateTicketRequest) => Promise<void>;
  deleteTicket: (id: string) => Promise<void>;
  archiveTicket: (id: string) => Promise<void>;
  unarchiveTicket: (id: string) => Promise<void>;
  moveTicket: (id: string, status: TicketStatus, position?: number) => Promise<void>;
  addLink: (ticketId: string, link: { type: string; ref: string; label: string; url?: string }) => Promise<void>;
  removeLink: (ticketId: string, linkId: string) => Promise<void>;
  importGitHubIssue: (url: string, boardId: string, status?: import('@fleex/shared').TicketStatus) => Promise<Ticket>;
  importSlackMessage: (url: string, boardId: string, status?: import('@fleex/shared').TicketStatus) => Promise<Ticket>;
  retrySlackImport: (ticketId: string) => Promise<void>;
  syncGithubIssue: (ticketId: string) => Promise<void>;
  openSessionFromTicket: (id: string) => Promise<{ sessionId: string }>;
  selectBoard: (id: string | null) => void;
  selectTicket: (id: string | null) => void;
  setTicketTab: (tab: TicketTab) => void;
  setStatusFilter: (filter: TicketStatus | 'all') => void;
  setSearchQuery: (query: string) => void;
  setFilters: (filters: Partial<TicketFilters>) => void;
  clearFilters: () => void;

  // Derived
  ticketsByColumn: (boardId: string | null) => Record<string, Ticket[]>;

  // WebSocket
  handleWsMessage: (msg: TicketWsMessage) => void;
}

/** Extract repo/branch info from a ticket's worktree or repository links. */
function getTicketRepoWorktreeInfo(t: Ticket): { repo: string; branch: string | null } | null {
  const wtLink = t.links.find((l: TicketLink) => l.type === 'worktree');
  if (wtLink) {
    const colonIdx = wtLink.ref.indexOf(':');
    if (colonIdx > 0) {
      return { repo: wtLink.ref.substring(0, colonIdx), branch: wtLink.ref.substring(colonIdx + 1) };
    }
  }
  const repoLink = t.links.find((l: TicketLink) => l.type === 'repository');
  if (repoLink) {
    return { repo: repoLink.ref, branch: null };
  }
  return null;
}

const BOARD_STORAGE_KEY = 'fleex:lastBoardId';
const ALL_BOARDS_SENTINEL = '__all__';

function loadPersistedBoardId(): string | null | undefined {
  const stored = localStorage.getItem(BOARD_STORAGE_KEY);
  if (stored === ALL_BOARDS_SENTINEL) return null;   // explicitly chose "All boards"
  if (stored) return stored;                          // specific board id
  return undefined;                                   // never set — will auto-select
}

export const useTicketStore = create<TicketState>((set, get) => ({
  boards: [],
  tickets: [],
  selectedBoardId: loadPersistedBoardId() ?? null,
  selectedTicketId: null,
  ticketTab: 'description',
  statusFilter: 'all',
  searchQuery: '',
  filters: { repo: null, priority: null, type: null, hasSession: null, tag: null, favorite: null, hideOldDoneCancelled: true },

  fetchBoards: async () => {
    const boards = await api.fetchBoards();
    set({ boards });
    const persisted = loadPersistedBoardId();
    if (persisted === null) {
      // User explicitly chose "All boards" — keep it
      set({ selectedBoardId: null });
    } else if (persisted && boards.some((b) => b.id === persisted)) {
      // Persisted board still exists
      set({ selectedBoardId: persisted });
    } else {
      // Never set or board was deleted — fall back to first
      const fallback = boards[0]?.id ?? null;
      set({ selectedBoardId: fallback });
      if (fallback) localStorage.setItem(BOARD_STORAGE_KEY, fallback);
    }
  },

  fetchTickets: async () => {
    const tickets = await api.fetchTickets();
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
    get().fetchBoards();
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
    get().fetchBoards();
  },

  archiveTicket: async (id) => {
    await api.archiveTicket(id);
    set((s) => ({
      tickets: s.tickets.filter((t) => t.id !== id),
      selectedTicketId: s.selectedTicketId === id ? null : s.selectedTicketId,
    }));
    get().fetchBoards();
  },

  unarchiveTicket: async (id) => {
    const ticket = await api.unarchiveTicket(id);
    set((s) => {
      if (s.tickets.some((t) => t.id === ticket.id)) return s;
      return { tickets: [...s.tickets, ticket] };
    });
    get().fetchBoards();
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
        t.id === ticketId ? { ...t, links: t.links.filter((l: TicketLink) => l.id !== linkId) } : t,
      ),
    }));
  },

  importGitHubIssue: async (url, boardId, status) => {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (!match) throw new Error('Invalid GitHub issue URL');
    const [, org, name, num] = match as RegExpMatchArray & [string, string, string, string];
    const ticket = await api.importGitHubIssue(org!, name!, parseInt(num!, 10), boardId);
    // If a specific status was requested (e.g. creating in a specific column), move the ticket
    if (status && status !== statusAnchors.defaultNew()) {
      const moved = await api.moveTicket(ticket.id, status);
      set((s) => {
        if (s.tickets.some((t) => t.id === moved.id)) return s;
        return { tickets: [...s.tickets, moved] };
      });
      return moved;
    }
    set((s) => {
      if (s.tickets.some((t) => t.id === ticket.id)) return s;
      return { tickets: [...s.tickets, ticket] };
    });
    return ticket;
  },

  importSlackMessage: async (url, boardId, status) => {
    const ticket = await api.importSlackMessage(url, boardId);
    // If a specific status was requested (e.g. creating in a specific column), move the ticket
    if (status && status !== statusAnchors.defaultNew()) {
      const moved = await api.moveTicket(ticket.id, status);
      set((s) => {
        if (s.tickets.some((t) => t.id === moved.id)) return s;
        return { tickets: [...s.tickets, moved] };
      });
      return moved;
    }
    set((s) => {
      if (s.tickets.some((t) => t.id === ticket.id)) return s;
      return { tickets: [...s.tickets, ticket] };
    });
    return ticket;
  },

  retrySlackImport: async (ticketId) => {
    // Re-arms the failed import on the server (flips it back to pending and re-runs the
    // synthesis). The returned pending ticket is applied immediately; the eventual success
    // or new failure arrives via the ticket:updated WebSocket broadcast.
    const updated = await api.retrySlackImport(ticketId);
    set((s) => ({
      tickets: s.tickets.map((t) => (t.id === ticketId ? updated : t)),
    }));
  },

  syncGithubIssue: async (ticketId) => {
    const updated = await api.syncGithubIssue(ticketId);
    set((s) => ({
      tickets: s.tickets.map((t) => (t.id === ticketId ? updated : t)),
    }));
  },

  openSessionFromTicket: async (id) => {
    return api.openSessionFromTicket(id);
  },

  selectBoard: (id) => {
    set({ selectedBoardId: id, selectedTicketId: null });
    localStorage.setItem(BOARD_STORAGE_KEY, id ?? ALL_BOARDS_SENTINEL);
  },
  selectTicket: (id) => set((s) => ({
    selectedTicketId: id,
    ticketTab: id !== s.selectedTicketId ? 'description' : s.ticketTab,
  })),
  setTicketTab: (tab) => set({ ticketTab: tab }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilters: (partial) => set((s) => ({ filters: { ...s.filters, ...partial } })),
  clearFilters: () => set({ filters: { repo: null, priority: null, type: null, hasSession: null, tag: null, favorite: null, hideOldDoneCancelled: true } }),

  ticketsByColumn: (boardId) => {
    const { tickets, searchQuery, filters } = get();
    let filtered = boardId ? tickets.filter((t) => t.boardId === boardId) : tickets;

    // Text search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        t.tags.some((tag: string) => tag.toLowerCase().includes(q)),
      );
    }

    // Repository filter
    if (filters.repo) {
      const repoKey = filters.repo;
      filtered = filtered.filter((t) =>
        t.links.some((l: TicketLink) =>
          (l.type === 'worktree' && l.ref.startsWith(repoKey + ':')) ||
          (l.type === 'repository' && l.ref === repoKey),
        ),
      );
    }

    // Priority filter
    if (filters.priority) {
      filtered = filtered.filter((t) => t.priority === filters.priority);
    }

    // Type filter
    if (filters.type) {
      filtered = filtered.filter((t) => t.type === filters.type);
    }

    // Has session filter (mirrors badge logic in KanbanCard)
    if (filters.hasSession !== null) {
      const runningSessions = useSessionStore.getState().sessions;
      filtered = filtered.filter((t) => {
        let has = t.links.some((l: TicketLink) => l.type === 'session');
        if (!has) {
          const repoInfo = getTicketRepoWorktreeInfo(t);
          if (repoInfo) {
            const [org, name] = repoInfo.repo.split('/');
            has = runningSessions.some(
              (s) =>
                s.status === 'running' &&
                s.repositoryOrg === org &&
                s.repositoryName === name &&
                s.worktreeBranch === repoInfo.branch,
            );
          }
        }
        return filters.hasSession ? has : !has;
      });
    }

    // Tag filter
    if (filters.tag) {
      const tag = filters.tag;
      filtered = filtered.filter((t) => t.tags.includes(tag));
    }

    // Favorite filter
    if (filters.favorite !== null) {
      filtered = filtered.filter((t) => t.favorite === filters.favorite);
    }

    // Auto-hide terminal (done/cancelled) tickets older than 7 days
    if (filters.hideOldDoneCancelled) {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      filtered = filtered.filter((t) => {
        if (!Status.of(t.status).isTerminal()) return true;
        return new Date(t.statusChangedAt).getTime() > sevenDaysAgo;
      });
    }

    const columns = {} as Record<string, Ticket[]>;
    // Iterate the active status model's columns (dynamic) in display order.
    const modelColumns = [...getActiveStatusModel().columns].sort((a, b) => a.order - b.order);
    for (const c of modelColumns) {
      const col = filtered.filter((t) => t.status === c.key);
      // Terminal columns sort by recency of closure; others by manual position.
      columns[c.key] = c.terminal
        ? col.sort((a, b) => new Date(b.statusChangedAt).getTime() - new Date(a.statusChangedAt).getTime())
        : col.sort((a, b) => a.position - b.position);
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
        if (ticket.archivedAt) {
          // Ticket was archived — remove from board state
          set((s) => ({
            tickets: s.tickets.filter((t) => t.id !== ticket.id),
            selectedTicketId: s.selectedTicketId === ticket.id ? null : s.selectedTicketId,
          }));
        } else {
          set((s) => {
            const exists = s.tickets.some((t) => t.id === ticket.id);
            return exists
              ? { tickets: s.tickets.map((t) => (t.id === ticket.id ? ticket : t)) }
              : { tickets: [...s.tickets, ticket] };
          });
        }
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
