export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class SessionNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Session not found: ${id}`, 'SESSION_NOT_FOUND');
  }
}

export class SessionAlreadyExistsError extends DomainError {
  constructor(name: string) {
    super(`Session already exists: ${name}`, 'SESSION_ALREADY_EXISTS');
  }
}

export class TmuxNotAvailableError extends DomainError {
  constructor() {
    super('tmux is not available on this system', 'TMUX_NOT_AVAILABLE');
  }
}

export class WorktreeError extends DomainError {
  constructor(message: string) {
    super(message, 'WORKTREE_ERROR');
  }
}

export class RepositoryNotFoundError extends DomainError {
  constructor(path: string) {
    super(`Repository not found: ${path}`, 'REPOSITORY_NOT_FOUND');
  }
}

export class BoardNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Board not found: ${id}`, 'BOARD_NOT_FOUND');
  }
}

export class TicketNotFoundError extends DomainError {
  constructor(id: string) {
    super(`Ticket not found: ${id}`, 'TICKET_NOT_FOUND');
  }
}

export class ApiTokenInvalidError extends DomainError {
  constructor() {
    super('Invalid or missing API token', 'API_TOKEN_INVALID');
  }
}

export class LastBoardError extends DomainError {
  constructor() {
    super('Cannot delete the last board', 'LAST_BOARD');
  }
}
