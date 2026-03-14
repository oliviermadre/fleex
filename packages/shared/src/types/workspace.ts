export interface WorkspaceRepo {
  readonly org: string;
  readonly name: string;
  readonly branch: string;
  readonly bare: boolean;
}

export interface Workspace {
  readonly ticketId: string;
  readonly repos: WorkspaceRepo[];
  readonly createdAt: string;
}
