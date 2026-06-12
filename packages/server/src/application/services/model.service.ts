import Anthropic from '@anthropic-ai/sdk';
import { FALLBACK_MODELS, inferModelCapabilities, type ModelFamily, type ModelOption } from '@fleex/shared';
import type { LoggerPort } from '../ports/logger.port.js';

const FAMILY_ORDER: Record<ModelFamily, number> = {
  opus: 0,
  sonnet: 1,
  haiku: 2,
  other: 3,
};

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h

interface AnthropicModelEntry {
  id: string;
  display_name?: string | null;
  type?: string;
  created_at?: string;
}

export class ModelService {
  private cache: ModelOption[] | null = null;
  private cacheExpiry = 0;
  private inflight: Promise<ModelOption[]> | null = null;

  constructor(
    private readonly logger: LoggerPort,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly clientFactory: () => Anthropic = () => new Anthropic(),
  ) {}

  async getAvailableModels(): Promise<{ models: ModelOption[]; fallback: boolean }> {
    if (this.cache && Date.now() < this.cacheExpiry) {
      return { models: this.cache, fallback: false };
    }

    if (!this.inflight) {
      this.inflight = this.fetchAndCache().finally(() => {
        this.inflight = null;
      });
    }

    try {
      const models = await this.inflight;
      return { models, fallback: false };
    } catch (err) {
      this.logger.warn('ModelService: falling back to static models', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { models: FALLBACK_MODELS, fallback: true };
    }
  }

  private async fetchAndCache(): Promise<ModelOption[]> {
    const client = this.clientFactory();
    // SDK exposes auto-pagination via .list(); we just take the first page,
    // which is fine — Anthropic returns far fewer than 1000 models.
    const page = await client.models.list({ limit: 1000 });
    const raw = (page.data ?? []) as AnthropicModelEntry[];

    const mapped = raw
      .filter((m) => typeof m.id === 'string' && m.id.startsWith('claude-'))
      .filter((m) => !isLegacy(m.id))
      .map(toModelOption);

    // Deduplicate by id (Anthropic sometimes lists snapshot aliases)
    const seen = new Set<string>();
    const unique = mapped.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    unique.sort(compareModels);

    this.cache = unique.length > 0 ? unique : FALLBACK_MODELS;
    this.cacheExpiry = Date.now() + this.ttlMs;
    return this.cache;
  }
}

function isLegacy(id: string): boolean {
  // Exclude pre-Claude-3 generations and instant variants.
  return (
    id.includes('-instant-') ||
    /claude-[12](\.|-)/.test(id) ||
    id.includes('-v1') ||
    id.includes('-v2')
  );
}

function familyOf(id: string): ModelFamily {
  if (id.includes('opus')) return 'opus';
  if (id.includes('sonnet')) return 'sonnet';
  if (id.includes('haiku')) return 'haiku';
  return 'other';
}

function toModelOption(entry: AnthropicModelEntry): ModelOption {
  const caps = inferModelCapabilities(entry.id);
  return {
    id: entry.id,
    label: entry.display_name?.trim() || deriveLabel(entry.id),
    family: familyOf(entry.id),
    supportsEffort: caps.supportsEffort,
    supportsFastMode: caps.supportsFastMode,
  };
}

function deriveLabel(id: string): string {
  // 'claude-opus-4-8' → 'Claude Opus 4.8'
  return id
    .split('-')
    .map((seg, i, arr) => {
      // Join numeric segments with dots: 4-8 → 4.8
      if (/^\d+$/.test(seg) && i > 0 && /^\d+$/.test(arr[i - 1] ?? '')) return `.${seg}`;
      if (/^\d+$/.test(seg)) return ` ${seg}`;
      return ` ${seg.charAt(0).toUpperCase()}${seg.slice(1)}`;
    })
    .join('')
    .replace(/\s+\./g, '.')
    .trim();
}

/**
 * Extract a numeric weight from a model id for descending version sort.
 * 'claude-opus-4-8' → 408; 'claude-sonnet-4-6' → 406; 'claude-haiku-4-5' → 405.
 * Unknown shapes get 0.
 */
function versionWeight(id: string): number {
  const nums = id.match(/\d+/g);
  if (!nums || nums.length === 0) return 0;
  // Take the last two numeric tokens to form a "major.minor" key.
  const last = nums[nums.length - 1] ?? '0';
  const prev = nums.length > 1 ? nums[nums.length - 2] ?? '0' : '0';
  return parseInt(prev, 10) * 100 + parseInt(last, 10);
}

function compareModels(a: ModelOption, b: ModelOption): number {
  const f = FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family];
  if (f !== 0) return f;
  // Descending version
  const v = versionWeight(b.id) - versionWeight(a.id);
  if (v !== 0) return v;
  return a.id.localeCompare(b.id);
}
