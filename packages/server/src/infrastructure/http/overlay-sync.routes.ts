import type { FastifyInstance } from 'fastify';
import type {
  OverlaySyncApplyRequest,
  OverlaySyncPreviewRequest,
  OverlaySyncRemoveRequest,
  OverlaySyncScanRequest,
  OverlaySyncScanResponse,
} from '@fleex/shared';
import type { Container } from '../container.js';

/**
 * Overlay sync: capture a worktree's gitignored files into the per-repo
 * overlay (`overlays/<org>/<name>/files`). All worktree paths are validated
 * against the managed base directory to prevent path traversal.
 */
export function overlaySyncRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    const { overlayManager, resolver } = container;

    const assertManaged = (worktreePath: string): void => {
      if (!worktreePath || !resolver.isManagedPath(worktreePath)) {
        const err = new Error('Worktree path is outside the managed workspace root');
        (err as { statusCode?: number }).statusCode = 400;
        throw err;
      }
    };

    // Scan every requested repo of a workspace.
    app.post<{ Body: OverlaySyncScanRequest }>('/api/overlay-sync/scan', async (request) => {
      const repos = request.body?.repos ?? [];
      const groups = await Promise.all(
        repos.map(async (repo) => {
          if (!repo.worktreePath || !resolver.isManagedPath(repo.worktreePath)) {
            return {
              org: repo.org,
              name: repo.name,
              worktreePath: repo.worktreePath,
              overlayFilesDir: '',
              available: false,
              message: 'Worktree path is outside the managed workspace root',
              tree: [],
              overlayContents: [],
            };
          }
          return overlayManager.scanForSync(repo.org, repo.name, repo.worktreePath);
        }),
      );
      return { groups } satisfies OverlaySyncScanResponse;
    });

    // Preview one file's local + overlay content (for an informed copy).
    app.post<{ Body: OverlaySyncPreviewRequest }>('/api/overlay-sync/preview', async (request) => {
      const { org, name, worktreePath, relPath } = request.body;
      assertManaged(worktreePath);
      return overlayManager.previewFile(org, name, worktreePath, relPath);
    });

    // Copy the selected files into their overlays (additive — never deletes).
    app.post<{ Body: OverlaySyncApplyRequest }>('/api/overlay-sync/apply', async (request) => {
      const items = request.body?.items ?? [];
      for (const item of items) assertManaged(item.worktreePath);
      return overlayManager.copyToOverlay(items);
    });

    // Explicitly remove files from a repo's overlay (cleanup gesture).
    app.post<{ Body: OverlaySyncRemoveRequest }>('/api/overlay-sync/remove', async (request) => {
      const { org, name, relPaths } = request.body;
      return overlayManager.removeFromOverlay(org, name, relPaths ?? []);
    });
  };
}
