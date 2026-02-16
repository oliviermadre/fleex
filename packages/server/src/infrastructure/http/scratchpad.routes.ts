import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

const SCRATCHPAD_DIR = '.asm';
const SCRATCHPAD_FILE = 'scratchpad.md';
const SCRATCHPADS_SUBDIR = 'scratchpads';

export function scratchpadRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    const { hostFs, hostHomedir } = container;
    const dirPath = join(hostHomedir, SCRATCHPAD_DIR);
    const filePath = join(dirPath, SCRATCHPAD_FILE);
    const scratchpadsDir = join(dirPath, SCRATCHPADS_SUBDIR);

    /**
     * GET /api/scratchpad
     * Returns the markdown content of the scratchpad file.
     */
    app.get('/api/scratchpad', async (_request, reply) => {
      if (!(await hostFs.exists(filePath))) {
        return { content: '' };
      }
      const content = await hostFs.readFile(filePath);
      return { content };
    });

    /**
     * PUT /api/scratchpad
     * Saves markdown content to the scratchpad file.
     */
    app.put<{ Body: { content: string } }>('/api/scratchpad', async (request, reply) => {
      const { content } = request.body;

      if (!(await hostFs.exists(dirPath))) {
        await hostFs.mkdir(dirPath);
      }

      await hostFs.writeFile(filePath, content);
      return { ok: true };
    });

    /**
     * GET /api/scratchpads/:org/:name
     * Returns the markdown content of a repo-specific scratchpad.
     */
    app.get<{ Params: { org: string; name: string } }>(
      '/api/scratchpads/:org/:name',
      async (request) => {
        const { org, name } = request.params;
        const repoFilePath = join(scratchpadsDir, org, `${name}.md`);

        if (!(await hostFs.exists(repoFilePath))) {
          return { content: '' };
        }
        const content = await hostFs.readFile(repoFilePath);
        return { content };
      },
    );

    /**
     * PUT /api/scratchpads/:org/:name
     * Saves markdown content to a repo-specific scratchpad.
     */
    app.put<{ Params: { org: string; name: string }; Body: { content: string } }>(
      '/api/scratchpads/:org/:name',
      async (request) => {
        const { org, name } = request.params;
        const { content } = request.body;
        const orgDir = join(scratchpadsDir, org);

        if (!(await hostFs.exists(orgDir))) {
          await hostFs.mkdir(dirPath);
          await hostFs.mkdir(scratchpadsDir);
          await hostFs.mkdir(orgDir);
        }

        await hostFs.writeFile(join(orgDir, `${name}.md`), content);
        return { ok: true };
      },
    );

    /**
     * GET /api/scratchpads
     * Lists all scratchpads with line counts.
     * Query: ?repos=org1/name1,org2/name2
     */
    app.get<{ Querystring: { repos?: string } }>(
      '/api/scratchpads',
      async (request) => {
        const items: { key: string; label: string; lineCount: number }[] = [];

        // Global scratchpad
        let globalLineCount = 0;
        if (await hostFs.exists(filePath)) {
          const content = await hostFs.readFile(filePath);
          globalLineCount = content.split('\n').filter((l) => l.trim() !== '').length;
        }
        items.push({ key: '__global__', label: 'Global', lineCount: globalLineCount });

        // Collect repos from query param
        const reposParam = request.query.repos;
        const configuredRepos = reposParam
          ? reposParam.split(',').filter(Boolean)
          : [];

        // Track which repos we've already added
        const seen = new Set<string>();

        // Scan existing scratchpad files on disk
        if (await hostFs.exists(scratchpadsDir)) {
          try {
            const orgEntries = await hostFs.readdir(scratchpadsDir);
            for (const orgEntry of orgEntries) {
              if (!orgEntry.isDirectory) continue;
              const orgPath = join(scratchpadsDir, orgEntry.name);
              const fileEntries = await hostFs.readdir(orgPath);
              for (const fileEntry of fileEntries) {
                if (!fileEntry.isFile || !fileEntry.name.endsWith('.md')) continue;
                const repoName = fileEntry.name.replace(/\.md$/, '');
                const key = `${orgEntry.name}/${repoName}`;
                if (seen.has(key)) continue;
                seen.add(key);

                const repoFilePath = join(orgPath, fileEntry.name);
                const content = await hostFs.readFile(repoFilePath);
                const lineCount = content.split('\n').filter((l) => l.trim() !== '').length;
                items.push({ key, label: key, lineCount });
              }
            }
          } catch {
            // directory scan failed, continue
          }
        }

        // Add configured repos that don't have files yet
        for (const repo of configuredRepos) {
          if (!seen.has(repo)) {
            seen.add(repo);
            items.push({ key: repo, label: repo, lineCount: 0 });
          }
        }

        return { items };
      },
    );
  };
}
