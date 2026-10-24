import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import {
  parseReleaseEntry,
  parseReleaseHeader,
  sortReleaseEntries,
  type Release,
  type ReleaseEntry,
} from '@fleex/shared';

/**
 * Illustrated release notes, read from the server's own checkout (`releases/`).
 * Contract: docs/releases.md.
 *
 *   GET /api/releases[?unreleased=1]
 *   GET /api/releases/assets/<N|unreleased>/<path>
 */

// src/infrastructure/http (or dist/infrastructure/http) → repo root.
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_DIR = path.resolve(MODULE_DIR, '../../../../..');

/** Root of this server's own checkout (`FLEEX_REPO_DIR` wins). */
export function fleexRepoDir(): string {
  return process.env['FLEEX_REPO_DIR'] ?? DEFAULT_REPO_DIR;
}

export function defaultReleasesDir(): string {
  return path.join(fleexRepoDir(), 'releases');
}

const IMAGE_MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

interface WarnLogger {
  warn: (msg: string) => void;
}

export interface ReleasesRoutesOptions {
  /** Directory holding `<N>/` and `unreleased/`. Defaults to `<repo>/releases`. */
  dir?: string;
  logger?: WarnLogger;
}

async function listDir(dir: string): Promise<{ name: string; isDir: boolean }[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return [];
  }
}

function assetUrl(dirName: string, rel: string): string {
  return `/api/releases/assets/${dirName}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

/** Parse every fragment of `<root>/<dirName>/*.md` (except release.md), rewrite image paths, sort. */
async function readEntries(root: string, dirName: string, log: WarnLogger): Promise<ReleaseEntry[]> {
  const dir = path.join(root, dirName);
  const files = (await listDir(dir)).filter(
    (f) => !f.isDir && f.name.endsWith('.md') && f.name !== 'release.md' && !f.name.startsWith('.'),
  );
  const entries: ReleaseEntry[] = [];
  for (const f of files) {
    const slug = f.name.slice(0, -'.md'.length);
    try {
      const parsed = parseReleaseEntry(slug, await readFile(path.join(dir, f.name), 'utf-8'));
      if (!parsed.ok) {
        log.warn(`[releases] skipping ${dirName}/${f.name}: ${parsed.errors.join('; ')}`);
        continue;
      }
      const entry = parsed.value;
      entries.push({
        ...entry,
        images: entry.images.map((img) => ({
          ...img,
          src: assetUrl(dirName, img.src),
          ...(img.light ? { light: assetUrl(dirName, img.light) } : {}),
        })),
      });
    } catch (e) {
      log.warn(`[releases] skipping ${dirName}/${f.name}: ${(e as Error).message}`);
    }
  }
  return sortReleaseEntries(entries);
}

export async function loadReleases(
  root: string,
  log: WarnLogger,
): Promise<{ current: number | null; releases: Release[] }> {
  const dirs = (await listDir(root)).filter((d) => d.isDir && /^\d+$/.test(d.name));
  const releases: Release[] = [];
  for (const d of dirs) {
    let text: string;
    try {
      text = await readFile(path.join(root, d.name, 'release.md'), 'utf-8');
    } catch {
      log.warn(`[releases] skipping releases/${d.name}: no release.md`);
      continue;
    }
    const header = parseReleaseHeader(text);
    if (!header.ok) {
      log.warn(`[releases] skipping releases/${d.name}: ${header.errors.join('; ')}`);
      continue;
    }
    if (header.value.number !== Number(d.name)) {
      log.warn(`[releases] skipping releases/${d.name}: release.md says number ${header.value.number}`);
      continue;
    }
    releases.push({ ...header.value, entries: await readEntries(root, d.name, log) });
  }
  releases.sort((a, b) => b.number - a.number);
  return { current: releases[0]?.number ?? null, releases };
}

/** Resolve `rel` under `root`; null when it escapes (`..`, absolute, symlink out) or is not a file. */
async function resolveAsset(root: string, rel: string): Promise<string | null> {
  if (!rel || rel.includes('\0') || rel.includes('\\')) return null;
  if (rel.split('/').some((seg) => seg === '..' || seg === '.')) return null;
  const rootReal = await realpath(root).catch(() => null);
  if (!rootReal) return null;
  const candidate = path.resolve(rootReal, rel);
  if (!candidate.startsWith(rootReal + path.sep)) return null;
  const real = await realpath(candidate).catch(() => null);
  if (!real || !real.startsWith(rootReal + path.sep)) return null;
  const st = await stat(real).catch(() => null);
  return st?.isFile() ? real : null;
}

export function releasesRoutes(options: ReleasesRoutesOptions = {}) {
  return async function (app: FastifyInstance) {
    const root = options.dir ?? defaultReleasesDir();
    const log: WarnLogger = options.logger ?? { warn: (msg) => app.log.warn(msg) };

    app.get<{ Querystring: { unreleased?: string } }>('/api/releases', async (request) => {
      const result = await loadReleases(root, log);
      const flag = request.query.unreleased;
      if (flag === '1' || flag === 'true') {
        return { ...result, unreleased: await readEntries(root, 'unreleased', log) };
      }
      return result;
    });

    app.get<{ Params: { '*': string } }>('/api/releases/assets/*', async (request, reply) => {
      const rel = request.params['*'] ?? '';
      const mime = IMAGE_MIME[path.extname(rel).toLowerCase()];
      const file = mime ? await resolveAsset(root, rel) : null;
      if (!mime || !file) return reply.code(404).send({ error: 'Not found' });
      const data = await readFile(file);
      return reply
        .header('Content-Type', mime)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'public, max-age=3600')
        .send(data);
    });
  };
}
