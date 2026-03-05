import { join, normalize, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import type { ClaudeConfigTreeEntry } from '@fleex/shared';
import type { HostFs } from '../host/types.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Validate and resolve a relative path to an absolute path under ~/.claude/ or ~/.claude.json.
 * Returns the absolute path on success, null on failure.
 */
function validatePath(relativePath: string, homedir: string): string | null {
  if (!relativePath || typeof relativePath !== 'string') return null;

  // Reject absolute paths
  if (relativePath.startsWith('/') || relativePath.startsWith('\\')) return null;

  // Reject traversal
  if (relativePath.includes('..')) return null;

  // Must start with .claude/ or be exactly .claude.json
  if (!relativePath.startsWith('.claude/') && relativePath !== '.claude' && relativePath !== '.claude.json') {
    return null;
  }

  const absolute = resolve(join(homedir, relativePath));
  const claudeDir = resolve(join(homedir, '.claude'));
  const claudeJson = resolve(join(homedir, '.claude.json'));

  // Re-check resolved path is under ~/.claude/ or is ~/.claude.json
  if (absolute === claudeJson || absolute === claudeDir || absolute.startsWith(claudeDir + '/')) {
    return absolute;
  }

  return null;
}

/**
 * Recursively build a file tree for a directory.
 */
async function buildTree(
  hostFs: HostFs,
  dirAbsolute: string,
  relativePath: string,
): Promise<ClaudeConfigTreeEntry[]> {
  let entries: { name: string; isFile: boolean; isDirectory: boolean }[];
  try {
    entries = await hostFs.readdir(dirAbsolute);
  } catch {
    return [];
  }

  const result: ClaudeConfigTreeEntry[] = [];

  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const entryRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    const entryAbsolute = join(dirAbsolute, entry.name);

    if (entry.isDirectory) {
      const children = await buildTree(hostFs, entryAbsolute, entryRelative);
      result.push({
        name: entry.name,
        relativePath: entryRelative,
        isDirectory: true,
        children,
      });
    } else {
      const stat = await hostFs.stat(entryAbsolute);
      result.push({
        name: entry.name,
        relativePath: entryRelative,
        isDirectory: false,
        size: stat?.size,
        mtimeMs: stat?.mtimeMs,
      });
    }
  }

  return result;
}

export function claudeConfigRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    /**
     * GET /api/claude-config/tree
     * Returns a recursive directory tree of ~/.claude/ + ~/.claude.json
     */
    app.get('/api/claude-config/tree', async (_request, reply) => {
      const { hostFs, hostHomedir } = container;
      const tree: ClaudeConfigTreeEntry[] = [];

      // Add ~/.claude/ directory tree
      const claudeDir = join(hostHomedir, '.claude');
      if (await hostFs.exists(claudeDir)) {
        const children = await buildTree(hostFs, claudeDir, '.claude');
        tree.push({
          name: '.claude',
          relativePath: '.claude',
          isDirectory: true,
          children,
        });
      }

      // Add ~/.claude.json as a top-level file
      const claudeJson = join(hostHomedir, '.claude.json');
      if (await hostFs.exists(claudeJson)) {
        const stat = await hostFs.stat(claudeJson);
        tree.push({
          name: '.claude.json',
          relativePath: '.claude.json',
          isDirectory: false,
          size: stat?.size,
          mtimeMs: stat?.mtimeMs,
        });
      }

      return tree;
    });

    /**
     * GET /api/claude-config/file?path=<relativePath>
     * Read the content of a file under ~/.claude/ or ~/.claude.json
     */
    app.get<{ Querystring: { path: string } }>('/api/claude-config/file', async (request, reply) => {
      const relativePath = request.query.path;
      const absolute = validatePath(relativePath, container.hostHomedir);

      if (!absolute) {
        return reply.code(400).send({ error: 'Invalid path' });
      }

      const { hostFs } = container;

      if (!(await hostFs.exists(absolute))) {
        return reply.code(404).send({ error: 'File not found' });
      }

      const stat = await hostFs.stat(absolute);
      if (stat && stat.size > MAX_FILE_SIZE) {
        return reply.code(413).send({ error: 'File too large (max 5 MB)' });
      }

      const content = await hostFs.readFile(absolute);
      return { content };
    });

    /**
     * PUT /api/claude-config/file
     * Save content to a file under ~/.claude/ or ~/.claude.json
     */
    app.put<{ Body: { path: string; content: string } }>('/api/claude-config/file', async (request, reply) => {
      const { path: relativePath, content } = request.body;
      const absolute = validatePath(relativePath, container.hostHomedir);

      if (!absolute) {
        return reply.code(400).send({ error: 'Invalid path' });
      }

      await container.hostFs.writeFile(absolute, content);
      return { ok: true };
    });

    /**
     * POST /api/claude-config/create
     * Create an empty file or directory under ~/.claude/
     */
    app.post<{ Body: { path: string; type: 'file' | 'directory' } }>('/api/claude-config/create', async (request, reply) => {
      const { path: relativePath, type } = request.body;
      const absolute = validatePath(relativePath, container.hostHomedir);

      if (!absolute) {
        return reply.code(400).send({ error: 'Invalid path' });
      }

      const { hostFs } = container;

      if (await hostFs.exists(absolute)) {
        return reply.code(409).send({ error: 'Already exists' });
      }

      if (type === 'directory') {
        await hostFs.mkdir(absolute);
      } else {
        await hostFs.writeFile(absolute, '');
      }

      return { ok: true };
    });

    /**
     * DELETE /api/claude-config/file
     * Delete a file or directory under ~/.claude/ (recursive for directories)
     */
    app.delete<{ Body: { path: string } }>('/api/claude-config/file', async (request, reply) => {
      const { path: relativePath } = request.body;
      const absolute = validatePath(relativePath, container.hostHomedir);

      if (!absolute) {
        return reply.code(400).send({ error: 'Invalid path' });
      }

      // Prevent deleting the .claude root directory itself
      const claudeDir = resolve(join(container.hostHomedir, '.claude'));
      if (absolute === claudeDir) {
        return reply.code(400).send({ error: 'Cannot delete .claude root directory' });
      }

      const { hostFs } = container;

      if (!(await hostFs.exists(absolute))) {
        return reply.code(404).send({ error: 'Not found' });
      }

      await hostFs.rm(absolute, { recursive: true });
      return { ok: true };
    });
  };
}
