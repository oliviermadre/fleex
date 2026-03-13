import type { Ticket } from './ticket.js';
import type { PullRequest, Worktree, GitHubIssue } from './repository.js';

export interface DashboardPullRequest extends PullRequest {
  readonly org: string;
  readonly name: string;
  linkedTicketId?: string;
}

export interface DashboardWorktree extends Worktree {
  readonly org: string;
  readonly name: string;
}

export interface DashboardGitHubIssue extends GitHubIssue {
  readonly org: string;
  readonly name: string;
  readonly hasLocalTicket: boolean;
  readonly linkedTicketId?: string;
}

export interface DashboardData {
  readonly activeTickets: Ticket[];
  readonly myPullRequests: DashboardPullRequest[];
  readonly reviewRequests: DashboardPullRequest[];
  readonly assignedIssues: DashboardGitHubIssue[];
  readonly activeWorktrees: DashboardWorktree[];
  readonly githubUser: string;
}
