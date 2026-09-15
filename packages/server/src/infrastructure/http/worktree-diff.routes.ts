import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { RepoDiff, RepoTree, WorktreeDiff, WorktreeFile, WorktreeTree } from '@fleex/shared';
import { buildTicketWorkspaceId } from '../../domain/services/branch-utils.js';
import { changedLineNumbers, parseUnifiedDiff } from '../../domain/services/diff-parser.js';
import { buildFileTree, parseStatusPorcelain } from '../../domain/services/file-tree.js';
import type { Container } from '../container.js';

/** Raw patch bytes above which a repo's diff is clipped and `truncated` is set. */
const DIFF_CAP_BYTES = 400 * 1024;
/** File-content bytes above which the viewer/editor response is clipped. */
const FILE_CAP_BYTES = 500 * 1024;
/** Effectively-unlimited tree depth: real worktrees (git-tracked files) are small. */
const TREE_DEPTH = 100;
/** NUL byte — its presence marks a file as binary. */
const NUL = String.fromCharCode(0);

interface RepoWorktree {
  repo: string; // "org/name"
  path: string; // absolute checkout path
  branch: string;
}

/**
 * Read-only Diff / Code / file endpoints for the Work view (Phase 2b), plus an
 * in-place file save for the Code editor. Ticket-scoped: `:id` is a ticket id. A
 * ticket can attach several repos, each with its own worktree, so responses are
 * combined lists keyed by repo. A ticket with no materialized worktree yields
 * empty lists (client shows its empty states).
 */
export function worktreeDiffRoutes(container: Container) {
  /** Resolve every attached repo whose worktree checkout exists on disk. */
  async function resolveWorktrees(ticketId: string): Promise<RepoWorktree[]> {
    const ticket = await container.ticketStore.getTicketById(ticketId);
    if (!ticket) return [];

    const workspaceId = buildTicketWorkspaceId(ticket.title, ticket.id);
    const repoLinks = ticket.links.filter((l) => l.type === 'repository' && l.ref?.includes('/'));
    const wtLinks = ticket.links.filter((l) => l.type === 'worktree' && l.ref);

    const resolved = await Promise.all(
      repoLinks.map(async (rl): Promise<RepoWorktree | null> => {
        const name = rl.ref.split('/')[1] ?? '';
        // Prefer the authoritative worktree-link path (matched by repo name);
        // fall back to the conventional workspace path.
        const link = wtLinks.find((l) => basename(l.ref) === name);
        const path = link?.ref ?? container.resolver.workspaceRepoPath(workspaceId, name);
        if (!(await container.hostFs.exists(path))) return null;
        return { repo: rl.ref, path, branch: link?.label ?? '' };
      }),
    );

    return resolved.filter((r): r is RepoWorktree => r !== null);
  }

  /**
   * Resolve `repo`+`path` for a ticket to an absolute path contained within that
   * repo's worktree. Returns null on any failure (unknown repo, escape attempt).
   */
  async function resolveContainedFile(
    ticketId: string,
    repo: string,
    relPath: string,
  ): Promise<{ abs: string; worktreePath: string } | null> {
    if (isAbsolute(relPath)) return null;
    const worktrees = await resolveWorktrees(ticketId);
    const wt = worktrees.find((w) => w.repo === repo);
    if (!wt) return null;
    const abs = resolve(wt.path, relPath);
    if (abs !== wt.path && !abs.startsWith(wt.path + sep)) return null;
    return { abs, worktreePath: wt.path };
  }

  return async function (app: FastifyInstance) {
    app.get<{ Params: { id: string } }>(
      '/api/worktrees/:id/diff',
      async (request): Promise<WorktreeDiff> => {
        const worktrees = await resolveWorktrees(request.params.id);

        const repos = await Promise.all(
          worktrees.map(async (wt): Promise<RepoDiff> => {
            if (wt.repo.includes('/')) {
              const [org, name] = wt.repo.split('/');
              if (org && name) {
                try {
                  await container.bareCloneManager.fetch(org, name);
                } catch {
                  // stale base acceptable
                }
              }
            }

            const defaultBranch = await container.git.getDefaultBranch(wt.path);
            const base = `origin/${defaultBranch}`;

            let patch: string;
            try {
              patch = await container.git.getDiffPatch(wt.path, base);
            } catch (err) {
              container.logger.warn('Failed to compute worktree diff', {
                ticketId: request.params.id, repo: wt.repo, path: wt.path, error: String(err),
              });
              return { repo: wt.repo, base, head: wt.branch, path: wt.path, files: [] };
            }

            const truncated = patch.length > DIFF_CAP_BYTES;
            const files = parseUnifiedDiff(truncated ? patch.slice(0, DIFF_CAP_BYTES) : patch);
            return { repo: wt.repo, base, head: wt.branch, path: wt.path, files, ...(truncated ? { truncated: true } : {}) };
          }),
        );

        return { repos };
      },
    );

    app.get<{ Params: { id: string } }>(
      '/api/worktrees/:id/tree',
      async (request): Promise<WorktreeTree> => {
        const worktrees = await resolveWorktrees(request.params.id);

        const repos = await Promise.all(
          worktrees.map(async (wt): Promise<RepoTree> => {
            const defaultBranch = await container.git.getDefaultBranch(wt.path);
            const base = `origin/${defaultBranch}`;
            const [trackedOut, changed, statusOut] = await Promise.all([
              container.git.listTrackedFiles(wt.path),
              // Changed vs base (committed + uncommitted) so the tree's dots match
              // the Diff panel; porcelain only contributes untracked files.
              container.git.getChangedFiles(wt.path, base),
              container.git.getStatusPorcelain(wt.path),
            ]);
            const tracked = trackedOut.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
            const { untracked } = parseStatusPorcelain(statusOut);
            const nodes = buildFileTree(tracked, changed, untracked, TREE_DEPTH);
            return { repo: wt.repo, branch: wt.branch, path: wt.path, nodes };
          }),
        );

        return { repos };
      },
    );

    app.get<{ Params: { id: string }; Querystring: { repo?: string; path?: string } }>(
      '/api/worktrees/:id/file',
      async (request, reply): Promise<WorktreeFile | undefined> => {
        const { repo, path: relPath } = request.query;
        if (!repo || !relPath) {
          return reply.code(400).send({ error: 'repo and path query parameters are required' });
        }

        const wt = await resolveContainedFile(request.params.id, repo, relPath);
        if (!wt) return reply.code(400).send({ error: 'Invalid repo or path' });

        const stat = await container.hostFs.stat(wt.abs);
        if (!stat) return reply.code(404).send({ error: 'File not found' });

        const raw = await container.hostFs.readFile(wt.abs);
        if (raw.includes(NUL)) {
          return { repo, path: relPath, content: '', changedLines: [], binary: true };
        }

        let changedLines: number[] = [];
        try {
          const defaultBranch = await container.git.getDefaultBranch(wt.worktreePath);
          const patch = await container.git.getFileDiffPatch(wt.worktreePath, relPath, `origin/${defaultBranch}`);
          changedLines = changedLineNumbers(patch);
        } catch {
          // gutter is best-effort
        }

        const truncated = raw.length > FILE_CAP_BYTES;
        return {
          repo,
          path: relPath,
          content: truncated ? raw.slice(0, FILE_CAP_BYTES) : raw,
          changedLines,
          ...(truncated ? { truncated: true } : {}),
        };
      },
    );

    app.get<{ Params: { id: string }; Querystring: { repo?: string; path?: string } }>(
      '/api/worktrees/:id/file/base',
      async (request, reply): Promise<{ content: string } | undefined> => {
        const { repo, path: relPath } = request.query;
        if (!repo || !relPath) {
          return reply.code(400).send({ error: 'repo and path query parameters are required' });
        }
        const wt = await resolveContainedFile(request.params.id, repo, relPath);
        if (!wt) return reply.code(400).send({ error: 'Invalid repo or path' });

        try {
          const defaultBranch = await container.git.getDefaultBranch(wt.worktreePath);
          const content = await container.git.getFileBaseContent(wt.worktreePath, relPath, `origin/${defaultBranch}`);
          return { content };
        } catch {
          return { content: '' };
        }
      },
    );

    app.put<{ Params: { id: string }; Body: { repo?: string; path?: string; content?: string } }>(
      '/api/worktrees/:id/file',
      async (request, reply) => {
        const { repo, path: relPath, content } = request.body;
        if (!repo || !relPath || typeof content !== 'string') {
          return reply.code(400).send({ error: 'repo, path and content are required' });
        }

        const wt = await resolveContainedFile(request.params.id, repo, relPath);
        if (!wt) return reply.code(400).send({ error: 'Invalid repo or path' });

        // Only overwrite files that already exist in the worktree (no creation).
        const stat = await container.hostFs.stat(wt.abs);
        if (!stat) return reply.code(404).send({ error: 'File not found' });

        await container.hostFs.writeFile(wt.abs, content);
        return reply.code(204).send();
      },
    );

    app.post<{ Params: { id: string }; Body: { repo?: string; path?: string; type?: 'file' | 'directory' } }>(
      '/api/worktrees/:id/file/create',
      async (request, reply) => {
        const { repo, path: relPath, type = 'file' } = request.body;
        if (!repo || !relPath) {
          return reply.code(400).send({ error: 'repo and path are required' });
        }

        const wt = await resolveContainedFile(request.params.id, repo, relPath);
        if (!wt) return reply.code(400).send({ error: 'Invalid repo or path' });
        if (await container.hostFs.exists(wt.abs)) {
          return reply.code(409).send({ error: 'Already exists' });
        }

        if (type === 'directory') {
          await container.hostFs.mkdir(wt.abs);
        } else {
          try {
            await container.hostFs.mkdir(dirname(wt.abs));
          } catch {
            // parent may already exist
          }
          await container.hostFs.writeFile(wt.abs, '');
        }
        return reply.code(201).send({ ok: true });
      },
    );

    app.delete<{ Params: { id: string }; Body: { repo?: string; path?: string } }>(
      '/api/worktrees/:id/file',
      async (request, reply) => {
        const { repo, path: relPath } = request.body;
        if (!repo || !relPath) {
          return reply.code(400).send({ error: 'repo and path are required' });
        }

        const wt = await resolveContainedFile(request.params.id, repo, relPath);
        if (!wt) return reply.code(400).send({ error: 'Invalid repo or path' });
        if (wt.abs === wt.worktreePath) {
          return reply.code(400).send({ error: 'Cannot delete the worktree root' });
        }

        const stat = await container.hostFs.stat(wt.abs);
        if (!stat) return reply.code(404).send({ error: 'File not found' });

        await container.hostFs.rm(wt.abs, { recursive: true });
        return reply.code(204).send();
      },
    );
  };
}
