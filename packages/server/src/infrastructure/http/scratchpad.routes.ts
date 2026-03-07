import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

const SCRATCHPAD_DIR = '.fleex';
const SCRATCHPAD_FILE = 'scratchpad.md';
const SCRATCHPADS_SUBDIR = 'scratchpads';

const KV_GLOBAL = 'scratchpad:__global__';
function kvKey(org: string, name: string): string {
  return `scratchpad:${org}/${name}`;
}

export function scratchpadRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    const { hostFs, hostHomedir, kvStore } = container;
    const dirPath = join(hostHomedir, SCRATCHPAD_DIR);
    const filePath = join(dirPath, SCRATCHPAD_FILE);
    const scratchpadsDir = join(dirPath, SCRATCHPADS_SUBDIR);

    // ── Global scratchpad ──

    app.get('/api/scratchpad', async () => {
      if (kvStore) {
        const content = await kvStore.get(KV_GLOBAL);
        if (content !== null) return { content };
        // Lazy migration: check filesystem fallback
        if (await hostFs.exists(filePath)) {
          const fsContent = await hostFs.readFile(filePath);
          if (fsContent) {
            await kvStore.set(KV_GLOBAL, fsContent);
            return { content: fsContent };
          }
        }
        return { content: '' };
      }
      if (!(await hostFs.exists(filePath))) return { content: '' };
      return { content: await hostFs.readFile(filePath) };
    });

    app.put<{ Body: { content: string } }>('/api/scratchpad', async (request) => {
      const { content } = request.body;
      if (kvStore) {
        await kvStore.set(KV_GLOBAL, content);
        return { ok: true };
      }
      if (!(await hostFs.exists(dirPath))) await hostFs.mkdir(dirPath);
      await hostFs.writeFile(filePath, content);
      return { ok: true };
    });

    // ── Repo-specific scratchpad ──

    app.get<{ Params: { org: string; name: string } }>(
      '/api/scratchpads/:org/:name',
      async (request) => {
        const { org, name } = request.params;
        if (kvStore) {
          const content = await kvStore.get(kvKey(org, name));
          if (content !== null) return { content };
          // Lazy migration: check filesystem fallback
          const repoFilePath = join(scratchpadsDir, org, `${name}.md`);
          if (await hostFs.exists(repoFilePath)) {
            const fsContent = await hostFs.readFile(repoFilePath);
            if (fsContent) {
              await kvStore.set(kvKey(org, name), fsContent);
              return { content: fsContent };
            }
          }
          return { content: '' };
        }
        const repoFilePath = join(scratchpadsDir, org, `${name}.md`);
        if (!(await hostFs.exists(repoFilePath))) return { content: '' };
        return { content: await hostFs.readFile(repoFilePath) };
      },
    );

    app.put<{ Params: { org: string; name: string }; Body: { content: string } }>(
      '/api/scratchpads/:org/:name',
      async (request) => {
        const { org, name } = request.params;
        const { content } = request.body;
        if (kvStore) {
          await kvStore.set(kvKey(org, name), content);
          return { ok: true };
        }
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

    // ── List all scratchpads ──

    app.get<{ Querystring: { repos?: string } }>(
      '/api/scratchpads',
      async (request) => {
        const items: { key: string; label: string; lineCount: number }[] = [];

        if (kvStore) {
          // KV-backed: list all scratchpad:* keys
          const globalContent = await kvStore.get(KV_GLOBAL);
          const globalLines = globalContent
            ? globalContent.split('\n').filter((l: string) => l.trim() !== '').length
            : 0;
          items.push({ key: '__global__', label: 'Global', lineCount: globalLines });

          const entries = await kvStore.listByPrefix('scratchpad:');
          const seen = new Set<string>();
          for (const entry of entries) {
            if (entry.key === KV_GLOBAL) continue;
            const key = entry.key.replace('scratchpad:', '');
            seen.add(key);
            const lineCount = entry.value.split('\n').filter((l: string) => l.trim() !== '').length;
            items.push({ key, label: key, lineCount });
          }

          // Add configured repos that don't have entries yet
          const reposParam = request.query.repos;
          const configuredRepos = reposParam ? reposParam.split(',').filter(Boolean) : [];
          for (const repo of configuredRepos) {
            if (!seen.has(repo)) {
              items.push({ key: repo, label: repo, lineCount: 0 });
            }
          }

          return { items };
        }

        // Filesystem-backed (original logic)
        let globalLineCount = 0;
        if (await hostFs.exists(filePath)) {
          const content = await hostFs.readFile(filePath);
          globalLineCount = content.split('\n').filter((l: string) => l.trim() !== '').length;
        }
        items.push({ key: '__global__', label: 'Global', lineCount: globalLineCount });

        const reposParam = request.query.repos;
        const configuredRepos = reposParam ? reposParam.split(',').filter(Boolean) : [];
        const seen = new Set<string>();

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
                const content = await hostFs.readFile(join(orgPath, fileEntry.name));
                const lineCount = content.split('\n').filter((l: string) => l.trim() !== '').length;
                items.push({ key, label: key, lineCount });
              }
            }
          } catch {
            // directory scan failed
          }
        }

        for (const repo of configuredRepos) {
          if (!seen.has(repo)) {
            items.push({ key: repo, label: repo, lineCount: 0 });
          }
        }

        return { items };
      },
    );
  };
}
