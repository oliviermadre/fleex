import type { IconSource, IconSuggestion } from '@fleex/shared';
import { iconifyBodyToSvg, sanitizeSvg } from '../../domain/services/svg-sanitizer.js';
import type { IconSearchPort } from '../../application/use-cases/suggest-action.js';

const API = 'https://api.iconify.design';
const SETS: IconSource[] = ['simple-icons', 'lucide', 'tabler'];
const LICENSES: Record<string, string> = { 'simple-icons': 'CC0-1.0', lucide: 'ISC', tabler: 'MIT' };
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 4_000;

type Fetch = typeof fetch;

/**
 * Iconify public API: free, keyless, and covers brand logos (simple-icons) as
 * well as the line sets Fleex already looks like (lucide, tabler).
 *
 * Only keywords are ever sent — never the user's command — and every SVG that
 * comes back is sanitised and inlined, so the saved action renders offline.
 */
export class IconifyClient implements IconSearchPort {
  private readonly cache = new Map<string, { at: number; value: IconSuggestion[] }>();

  constructor(private readonly fetchFn: Fetch = fetch) {}

  async search(
    keywords: string[],
    { brandFirst, limit, exclude = [], includeBrands = true }: { brandFirst: boolean; limit: number; exclude?: string[]; includeBrands?: boolean },
  ): Promise<IconSuggestion[]> {
    const sets = includeBrands ? SETS : SETS.filter((set) => set !== 'simple-icons');
    const key = `${brandFirst}|${sets.join(',')}|${keywords.join(',')}`;
    const cached = this.cache.get(key);
    let all: IconSuggestion[];
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      all = cached.value;
    } else {
      all = await this.fetchAll(keywords, brandFirst, sets);
      this.cache.set(key, { at: Date.now(), value: all });
    }
    const skip = new Set(exclude);
    return all.filter((s) => !skip.has(s.id)).slice(0, limit);
  }

  private async fetchAll(keywords: string[], brandFirst: boolean, sets: IconSource[]): Promise<IconSuggestion[]> {
    const ids: string[] = [];
    for (const keyword of keywords) {
      const url = `${API}/search?query=${encodeURIComponent(keyword)}&prefixes=${sets.join(',')}&limit=12`;
      const data = (await this.getJson(url)) as { icons?: string[] };
      for (const id of data.icons ?? []) if (!ids.includes(id)) ids.push(id);
    }
    if (brandFirst) ids.sort((a, b) => Number(!a.startsWith('simple-icons:')) - Number(!b.startsWith('simple-icons:')));

    const byPrefix = new Map<string, string[]>();
    for (const id of ids.slice(0, 18)) {
      const [prefix, name] = id.split(':');
      if (!prefix || !name || !sets.includes(prefix as IconSource)) continue;
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), name]);
    }

    const svgs = new Map<string, string>();
    for (const [prefix, names] of byPrefix) {
      const data = (await this.getJson(`${API}/${prefix}.json?icons=${names.map(encodeURIComponent).join(',')}`)) as {
        width?: number;
        height?: number;
        icons?: Record<string, { body: string; width?: number; height?: number }>;
      };
      for (const [name, icon] of Object.entries(data.icons ?? {})) {
        const svg = sanitizeSvg(iconifyBodyToSvg(icon.body, icon.width ?? data.width ?? 24, icon.height ?? data.height ?? 24));
        if (svg) svgs.set(`${prefix}:${name}`, svg);
      }
    }

    return ids
      .filter((id) => svgs.has(id))
      .map((id) => {
        const [prefix, name] = id.split(':') as [IconSource, string];
        return { id, source: prefix, name, svg: svgs.get(id)!, license: LICENSES[prefix] ?? 'unknown' };
      });
  }

  private async getJson(url: string): Promise<unknown> {
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Iconify ${res.status}`);
    return res.json();
  }
}
