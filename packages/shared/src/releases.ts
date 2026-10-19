/**
 * Release notes stored in the repo, under `releases/`.
 *
 *   releases/unreleased/<slug>.md              one entry per feature (a "fragment")
 *   releases/unreleased/assets/<slug>/*.webp   its screenshots
 *   releases/<N>/release.md                    the release header (number, date, title)
 *   releases/<N>/<slug>.md                     the fragments, moved here at publish time
 *   releases/<N>/assets/<slug>/*.webp
 *
 * A fragment and a release header are Markdown files with a YAML front-matter.
 * This module parses and validates both, so the CLI (`fleex release validate`),
 * the server (`GET /api/releases`) and the tests apply the same rules.
 * Contract: docs/releases.md.
 */
import { parse as parseYaml } from 'yaml';

export const RELEASE_CATEGORIES = ['feature', 'improvement', 'fix', 'under-the-hood'] as const;
export type ReleaseCategory = (typeof RELEASE_CATEGORIES)[number];

/** A title is a headline, not a sentence: one idea, short enough to read at a glance. */
export const RELEASE_TITLE_MAX = 80;

export interface ReleaseImage {
  /** Path relative to the fragment's directory (e.g. `assets/697-qa/hero-dark.webp`). */
  src: string;
  /** Optional light-theme variant of the same shot. */
  light?: string;
  alt: string;
  caption?: string;
}

export interface ReleaseEntry {
  /** File name without `.md` — stable id of the entry. */
  slug: string;
  title: string;
  category: ReleaseCategory;
  /** Body: the user value, Markdown. */
  body: string;
  ticket?: string;
  prs: number[];
  audience: string[];
  /** Lower first; entries without order come after, by category then slug. */
  order?: number;
  lang: string;
  images: ReleaseImage[];
}

export interface ReleaseHeader {
  number: number;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  title: string;
  tagline?: string;
  themes: string[];
  /** Optional intro paragraph (the header file's body). */
  intro: string;
}

export interface Release extends ReleaseHeader {
  entries: ReleaseEntry[];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Split `---\nyaml\n---\nbody`. Returns null when there is no front-matter. */
export function splitFrontMatter(text: string): { data: unknown; body: string } | null {
  const m = FRONT_MATTER_RE.exec(text.replace(/^﻿/, ''));
  if (!m) return null;
  return { data: parseYaml(m[1]!), body: m[2]!.trim() };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringList(v: unknown, field: string, errors: string[]): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    errors.push(`"${field}" must be a list of strings`);
    return [];
  }
  return v as string[];
}

/** An asset path must stay inside the release directory: relative, no `..`. */
function isSafeRelativePath(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('\\') || /^[a-z]+:/i.test(p)) return false;
  return !p.split('/').some((seg) => seg === '..' || seg === '');
}

export function parseReleaseEntry(slug: string, text: string): ParseResult<ReleaseEntry> {
  let split: ReturnType<typeof splitFrontMatter>;
  try {
    split = splitFrontMatter(text);
  } catch (e) {
    return { ok: false, errors: [`invalid YAML front-matter: ${(e as Error).message.split('\n')[0]}`] };
  }
  if (!split || !isObject(split.data)) return { ok: false, errors: ['missing YAML front-matter (---)'] };
  const d = split.data;
  const errors: string[] = [];

  const title = typeof d.title === 'string' ? d.title.trim() : '';
  if (!title) errors.push('"title" is required');
  else if (title.length > RELEASE_TITLE_MAX) errors.push(`"title" is ${title.length} chars, max ${RELEASE_TITLE_MAX}`);

  const category = d.category as ReleaseCategory;
  if (!RELEASE_CATEGORIES.includes(category)) {
    errors.push(`"category" must be one of ${RELEASE_CATEGORIES.join(', ')}`);
  }

  if (!split.body) errors.push('the body (what the user can now do) is empty');

  let ticket: string | undefined;
  if (d.ticket !== undefined) {
    if (typeof d.ticket === 'string' || typeof d.ticket === 'number') ticket = String(d.ticket);
    else errors.push('"ticket" must be a string or a number');
  }

  let prs: number[] = [];
  if (d.prs !== undefined) {
    if (!Array.isArray(d.prs) || d.prs.some((x) => !Number.isInteger(x) || (x as number) <= 0)) {
      errors.push('"prs" must be a list of PR numbers');
    } else prs = d.prs as number[];
  }

  let order: number | undefined;
  if (d.order !== undefined) {
    if (typeof d.order === 'number' && Number.isFinite(d.order)) order = d.order;
    else errors.push('"order" must be a number');
  }

  const images: ReleaseImage[] = [];
  if (d.images !== undefined) {
    if (!Array.isArray(d.images)) errors.push('"images" must be a list');
    else {
      d.images.forEach((img, i) => {
        if (!isObject(img)) {
          errors.push(`images[${i}] must be an object`);
          return;
        }
        const src = typeof img.src === 'string' ? img.src : '';
        const alt = typeof img.alt === 'string' ? img.alt.trim() : '';
        const light = typeof img.light === 'string' ? img.light : undefined;
        if (!isSafeRelativePath(src)) errors.push(`images[${i}].src must be a relative path inside the release (got "${src}")`);
        if (img.light !== undefined && (!light || !isSafeRelativePath(light))) {
          errors.push(`images[${i}].light must be a relative path inside the release`);
        }
        if (!alt) errors.push(`images[${i}].alt is required (describe what the screenshot shows)`);
        images.push({
          src,
          alt,
          ...(light ? { light } : {}),
          ...(typeof img.caption === 'string' && img.caption.trim() ? { caption: img.caption.trim() } : {}),
        });
      });
    }
  }

  const audience = stringList(d.audience, 'audience', errors);
  const lang = typeof d.lang === 'string' && d.lang ? d.lang : 'fr';

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      slug,
      title,
      category,
      body: split.body,
      ...(ticket !== undefined ? { ticket } : {}),
      prs,
      audience,
      ...(order !== undefined ? { order } : {}),
      lang,
      images,
    },
  };
}

export function parseReleaseHeader(text: string): ParseResult<ReleaseHeader> {
  let split: ReturnType<typeof splitFrontMatter>;
  try {
    split = splitFrontMatter(text);
  } catch (e) {
    return { ok: false, errors: [`invalid YAML front-matter: ${(e as Error).message.split('\n')[0]}`] };
  }
  if (!split || !isObject(split.data)) return { ok: false, errors: ['missing YAML front-matter (---)'] };
  const d = split.data;
  const errors: string[] = [];

  if (!Number.isInteger(d.number) || (d.number as number) <= 0) errors.push('"number" must be a positive integer');
  // YAML turns an unquoted 2026-10-24 into a Date: accept both.
  const date = d.date instanceof Date ? d.date.toISOString().slice(0, 10) : typeof d.date === 'string' ? d.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('"date" must be YYYY-MM-DD');
  const title = typeof d.title === 'string' ? d.title.trim() : '';
  if (!title) errors.push('"title" is required');
  const themes = stringList(d.themes, 'themes', errors);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      number: d.number as number,
      date,
      title,
      ...(typeof d.tagline === 'string' && d.tagline.trim() ? { tagline: d.tagline.trim() } : {}),
      themes,
      intro: split.body,
    },
  };
}

const CATEGORY_RANK: Record<ReleaseCategory, number> = {
  feature: 0,
  improvement: 1,
  fix: 2,
  'under-the-hood': 3,
};

/** Display order: explicit `order` first, then features → improvements → fixes → under the hood. */
export function sortReleaseEntries(entries: ReleaseEntry[]): ReleaseEntry[] {
  return [...entries].sort((a, b) => {
    const oa = a.order ?? Number.POSITIVE_INFINITY;
    const ob = b.order ?? Number.POSITIVE_INFINITY;
    if (oa !== ob) return oa - ob;
    const ca = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
    if (ca !== 0) return ca;
    return a.slug.localeCompare(b.slug);
  });
}
