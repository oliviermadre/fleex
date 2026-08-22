import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { referencesNote } from '@fleex/shared';
import type { Container } from '../container.js';
import { isMemoryFeatureEnabled } from '../../application/ports/config.port.js';

/**
 * Notes semantically close to a given one.
 *
 * Queries the index with the note's own content, then drops the note itself —
 * which would otherwise be its own best match by a wide margin.
 */
async function relatedNotes(
  container: Container,
  sourceKey: string,
): Promise<Array<{ key: string; label: string; score: number }>> {
  const kvStore = container.kvStore;
  if (!kvStore) return [];

  const content = await kvStore.get(`scratchpad:${sourceKey}`);
  if (!content?.trim()) return [];

  const hits = await container.retrieveContext.search({
    query: content.slice(0, 2_000),
    limit: 6,
    kinds: ['scratchpad'],
  });

  return hits
    .filter((hit) => hit.sourceId !== sourceKey)
    .map((hit) => ({
      key: hit.sourceId,
      label: hit.sourceId === '__global__' ? 'Global' : hit.sourceId,
      score: hit.score,
    }));
}

const SCRATCHPAD_DIR = '.fleex';
const SCRATCHPAD_FILE = 'scratchpad.md';
const SCRATCHPADS_SUBDIR = 'scratchpads';

const KV_GLOBAL = 'scratchpad:__global__';
function kvKey(org: string, name: string): string {
  return `scratchpad:${org.toLowerCase()}/${name.toLowerCase()}`;
}

export function scratchpadRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    const { hostFs, hostHomedir, kvStore } = container;
    const dirPath = join(hostHomedir, SCRATCHPAD_DIR);
    const filePath = join(dirPath, SCRATCHPAD_FILE);
    const scratchpadsDir = join(dirPath, SCRATCHPADS_SUBDIR);

    /**
     * Announce a scratchpad write on the domain bus.
     *
     * These notes were the one body of hand-written knowledge in the workspace
     * that nothing could react to, because writes went straight to the KV store.
     * The event carries the same key the list endpoint reports, so a consumer
     * identifies a note the same way the UI does.
     */
    const announceWrite = (key: string, repo: string | null): void => {
      container.eventBus.emit({ type: 'scratchpad.updated', key, repo, occurredAt: new Date() });
    };

    /**
     * Which notes reference a target, and which notes are semantically close to one.
     *
     * Backlinks are computed by scanning every note rather than kept in a link
     * table: there are a handful of scratchpads, so a scan is cheaper than keeping
     * an index consistent through every edit — and a stale link table is worse
     * than none, because it silently hides connections. This half reads no index,
     * so it is unconditional: it works on either memory engine and regardless of
     * the `relatedNotes` flag, exactly as `@ticket:` references always have.
     *
     * Related notes, by contrast, come from the retrieval index, so only that
     * half is gated behind the `relatedNotes` flag and the semantic engine.
     */
    app.get<{ Querystring: { target?: string; key?: string } }>(
      '/api/scratchpads/links',
      async (request) => {
        const target = request.query.target?.trim();
        const backlinks: Array<{ key: string; label: string }> = [];

        // Exact backlinks are a text scan over a handful of notes — no index, so
        // no feature flag and no engine requirement. Navigating between notes is
        // not semantic memory, exactly as @ticket: has never been.
        if (target && kvStore) {
          for (const entry of await kvStore.listByPrefix('scratchpad:')) {
            const key = entry.key.slice('scratchpad:'.length);
            // A note listing itself as its own backlink is noise.
            if (key === request.query.key) continue;
            if (referencesNote(entry.value, target)) {
              backlinks.push({ key, label: key === '__global__' ? 'Global' : key });
            }
          }
        }

        // Related notes come from the index, so they surface connections nobody
        // thought to write a reference for — which is the half of a knowledge
        // graph manual linking never produces, and the half that needs the flag.
        const sourceKey = request.query.key?.trim();
        const related = sourceKey && kvStore
          && isMemoryFeatureEnabled(container.config.get(), 'relatedNotes')
          ? await relatedNotes(container, sourceKey)
          : [];

        return { backlinks, related };
      },
    );

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
        announceWrite('__global__', null);
        return { ok: true };
      }
      if (!(await hostFs.exists(dirPath))) await hostFs.mkdir(dirPath);
      await hostFs.writeFile(filePath, content);
      announceWrite('__global__', null);
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
          // Lazy migration: check case-variant key (e.g. ODYS-TRAVEL vs odys-travel)
          const rawKey = `scratchpad:${org}/${name}`;
          if (rawKey !== kvKey(org, name)) {
            const rawContent = await kvStore.get(rawKey);
            if (rawContent) {
              await kvStore.set(kvKey(org, name), rawContent);
              await kvStore.delete(rawKey);
              return { content: rawContent };
            }
          }
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
        const repo = `${org.toLowerCase()}/${name.toLowerCase()}`;
        if (kvStore) {
          await kvStore.set(kvKey(org, name), content);
          announceWrite(repo, repo);
          return { ok: true };
        }
        const orgDir = join(scratchpadsDir, org);
        if (!(await hostFs.exists(orgDir))) {
          await hostFs.mkdir(dirPath);
          await hostFs.mkdir(scratchpadsDir);
          await hostFs.mkdir(orgDir);
        }
        await hostFs.writeFile(join(orgDir, `${name}.md`), content);
        announceWrite(repo, repo);
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
