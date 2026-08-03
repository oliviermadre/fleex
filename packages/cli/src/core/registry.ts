import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type {
  MarketplaceManifest,
  MarketplacePrimitiveContent,
  MarketplacePrimitiveEntry,
} from '@fleex/shared';

import { FLEEX_HOME } from './instance.ts';

export const MARKETPLACES_DIR = path.join(FLEEX_HOME, 'marketplaces');
export const REGISTRY_FILE = path.join(FLEEX_HOME, 'marketplaces.json');

export interface RegisteredMarketplace {
  name: string;
  url: string;
  path: string; // local cache (git working copy)
}

export function readRegistry(): RegisteredMarketplace[] {
  try {
    const j = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    return Array.isArray(j?.marketplaces) ? j.marketplaces : [];
  } catch {
    return [];
  }
}

export function writeRegistry(list: RegisteredMarketplace[]): void {
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ marketplaces: list }, null, 2) + '\n');
}

export function getMarketplace(name: string): RegisteredMarketplace | undefined {
  return readRegistry().find((m) => m.name === name);
}

export function upsertMarketplace(entry: RegisteredMarketplace): void {
  const list = readRegistry().filter((m) => m.name !== entry.name);
  list.push(entry);
  writeRegistry(list);
}

export function removeMarketplace(name: string): boolean {
  const list = readRegistry();
  const next = list.filter((m) => m.name !== name);
  if (next.length === list.length) return false;
  writeRegistry(next);
  return true;
}

/** Derive a stable "owner-repo" name from a git URL. */
export function deriveName(url: string): string {
  const cleaned = url
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  const m = cleaned.match(/[:/]([^/:]+)\/([^/]+)$/);
  if (m) return `${m[1]}-${m[2]}`.toLowerCase();
  return (cleaned.split(/[/:]/).pop() || 'marketplace').toLowerCase();
}

/** Run a git command, returning success and combined output. */
export function git(args: string[], cwd?: string): { ok: boolean; output: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

export function loadManifest(dir: string): MarketplaceManifest {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'marketplace.json'), 'utf8'),
  ) as MarketplaceManifest;
  if (typeof manifest.schemaVersion !== 'number' || !Array.isArray(manifest.primitives)) {
    throw new Error('not a valid marketplace (bad marketplace.json)');
  }
  return manifest;
}

export function loadPrimitiveContent(
  dir: string,
  entry: MarketplacePrimitiveEntry,
): MarketplacePrimitiveContent {
  return JSON.parse(
    fs.readFileSync(path.join(dir, entry.path), 'utf8'),
  ) as MarketplacePrimitiveContent;
}
