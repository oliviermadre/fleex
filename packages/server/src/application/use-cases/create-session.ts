import { randomUUID } from 'node:crypto';
import type { CreateSessionRequest } from '@asm/shared';
import { SessionEntity } from '../../domain/entities.js';
import { SessionNamingService } from '../../domain/services/session-naming.js';
import { SessionAlreadyExistsError } from '../../domain/errors.js';
import type { TmuxPort } from '../ports/tmux.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { GitPort } from '../ports/git.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class CreateSessionUseCase {
  constructor(
    private readonly tmux: TmuxPort,
    private readonly sessionStore: SessionStorePort,
    private readonly namingService: SessionNamingService,
    private readonly git: GitPort,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(request: CreateSessionRequest): Promise<SessionEntity> {
    const tmuxName =
      request.type === 'claude'
        ? this.namingService.generateClaudeName(request.cwd)
        : this.namingService.generateShellName(request.cwd);

    if (await this.tmux.hasSession(tmuxName)) {
      throw new SessionAlreadyExistsError(tmuxName);
    }

    let repositoryOrg: string | null = null;
    let repositoryName: string | null = null;
    let worktreeBranch: string | null = null;
    let gitRemote: string | null = null;

    try {
      const gitInfo = await this.git.getInfo(request.cwd);
      repositoryOrg = gitInfo.org;
      repositoryName = gitInfo.name;
      worktreeBranch = gitInfo.branch;
      gitRemote = gitInfo.remote;
    } catch {
      this.logger.debug('No git info found for cwd', { cwd: request.cwd });
    }

    const command =
      request.type === 'shell' ? this.config.get().defaultShell : undefined;

    await this.tmux.createSession({ name: tmuxName, cwd: request.cwd, command });

    if (request.type === 'claude') {
      const claudeCmd = request.claudePrompt
        ? `${this.config.getClaudeCommand()} "${request.claudePrompt.replace(/"/g, '\\"')}"`
        : this.config.getClaudeCommand();
      await this.tmux.sendKeys(tmuxName, claudeCmd);
    }

    const session = new SessionEntity(
      randomUUID(),
      tmuxName,
      request.type,
      'running',
      request.cwd,
      new Date(),
      null,
      repositoryOrg,
      repositoryName,
      worktreeBranch,
      gitRemote,
      request.claudePrompt,
    );

    await this.sessionStore.save(session);
    this.logger.info('Session created', { id: session.id, type: request.type, tmuxName });

    return session;
  }
}
