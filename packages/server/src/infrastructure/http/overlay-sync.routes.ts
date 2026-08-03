import type {
  OverlaySyncApplyRequest,
  OverlaySyncPreviewRequest,
  OverlaySyncRemoveRequest,
  OverlaySyncScanRequest,
  OverlaySyncScanResponse,
} from '@fleex/shared';

import type { Container } from '../container.js';
import type { FastifyInstance } from 'fastify';

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

    // Discover every git worktree under a ticket's workspace root and scan each.
    app.post<{ Body: OverlaySyncScanRequest }>('/api/overlay-sync/scan', async (request) => {
      const rootPath = request.body?.rootPath ?? '';
      // Trust boundary: only walk paths inside the managed base. An out-of-base
      // or empty path yields nothing to sync rather than a hard error.
      if (!rootPath || !resolver.isManagedPath(rootPath)) {
        return { groups: [] } satisfies OverlaySyncScanResponse;
      }
      const groups = await overlayManager.scanWorkspace(rootPath);
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
