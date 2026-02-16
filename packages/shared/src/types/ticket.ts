export type TicketStatus = 'backlog' | 'todo' | 'doing' | 'reviewing' | 'done';
export type TicketPriority = 'none' | 'low' | 'medium' | 'high';
export type TicketLinkType = 'github_issue' | 'github_pr' | 'worktree' | 'session' | 'repository';

export interface TicketLink {
  readonly id: string;
  readonly type: TicketLinkType;
  readonly ref: string;
  readonly label: string;
  readonly url: string | null;
  readonly createdAt: string;
}

export interface Ticket {
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly description: string;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly position: number;
  readonly tags: string[];
  readonly links: TicketLink[];
  readonly blocked: boolean;
  readonly favorite: boolean;
  readonly dueDate: string | null;
  readonly assignee: string | null;
  readonly agentClaimedAt: string | null;
  readonly statusChangedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Board {
  readonly id: string;
  readonly name: string;
  readonly emoji: string;
  readonly repositoryOrg: string | null;
  readonly repositoryName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BoardWithCounts extends Board {
  readonly ticketCounts: Record<TicketStatus, number>;
}

export interface CreateTicketRequest {
  readonly boardId: string;
  readonly title: string;
  readonly description?: string;
  readonly status?: TicketStatus;
  readonly priority?: TicketPriority;
  readonly tags?: string[];
  readonly links?: Omit<TicketLink, 'id' | 'createdAt'>[];
  readonly dueDate?: string | null;
  readonly githubIssueUrl?: string;
  readonly worktreeBranch?: string;
}

export interface UpdateTicketRequest {
  readonly boardId?: string;
  readonly title?: string;
  readonly description?: string;
  readonly status?: TicketStatus;
  readonly priority?: TicketPriority;
  readonly position?: number;
  readonly tags?: string[];
  readonly blocked?: boolean;
  readonly favorite?: boolean;
  readonly dueDate?: string | null;
  readonly assignee?: string | null;
}

export interface CreateBoardRequest {
  readonly name: string;
  readonly emoji?: string;
  readonly repositoryOrg?: string | null;
  readonly repositoryName?: string | null;
}

export interface UpdateBoardRequest {
  readonly name?: string;
  readonly emoji?: string;
}

export interface TicketActivity {
  readonly id: string;
  readonly ticketId: string;
  readonly action: string;
  readonly changes: Record<string, { from: unknown; to: unknown }>;
  readonly actorType: 'user' | 'agent';
  readonly actorName: string | null;
  readonly source: 'web' | 'api';
  readonly createdAt: string;
}

export interface AgentToken {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

export interface AgentTokenCreated extends AgentToken {
  readonly secret: string;
}

export type TicketWsMessageType =
  | 'ticket:created'
  | 'ticket:updated'
  | 'ticket:deleted'
  | 'ticket:moved'
  | 'board:updated';

export interface TicketWsMessage {
  readonly type: TicketWsMessageType;
  readonly data: unknown;
}
