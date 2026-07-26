import { EFFORT_LEVELS, effortRank, isEffortLevel, type EffortLevel } from './ticket.js';

/**
 * A Claude model exposed in the UI dropdowns.
 * Sourced either from the Anthropic API (dynamic) or from FALLBACK_MODELS.
 */
export type ModelFamily = 'fable' | 'opus' | 'sonnet' | 'haiku' | 'other';

export interface ModelOption {
  id: string; // e.g. 'claude-opus-5'
  label: string; // e.g. 'Claude Opus 5'
  family: ModelFamily;
  /** Whether the model accepts a reasoning-effort level at all. */
  supportsEffort?: boolean;
  /** Whether the model supports a low-latency "fast mode". */
  supportsFastMode?: boolean;
  /**
   * Exactly the levels this model accepts, ascending. Empty when the model has
   * no effort parameter. This — not `supportsEffort` — is what the UI must
   * enumerate: a model can support effort while rejecting `xhigh` or `max`.
   */
  effortLevels?: readonly EffortLevel[];
}

export interface ModelCapabilities {
  supportsEffort: boolean;
  supportsFastMode: boolean;
  effortLevels: readonly EffortLevel[];
}

/**
 * Best-effort capability inference from a model id, used as a fallback when the
 * Anthropic API does not advertise capabilities.
 *
 * Three separate thresholds, because the ladder grew one rung at a time:
 *  - effort at all → Opus ≥ 4.5, Sonnet ≥ 4.6, and the Fable line (Claude 5 gen)
 *  - `max`         → the 4.6 generation on (so Opus 4.5 is effort-capable but caps at `high`)
 *  - `xhigh`       → Opus ≥ 4.7 and Sonnet ≥ 5 (it never shipped on Sonnet 4.6)
 *
 * Conservative by construction: unknown/older ids get no effort at all, so the
 * UI hides the control instead of offering a level the API would 400 on.
 */
export function inferModelCapabilities(id: string): ModelCapabilities {
  const lower = id.toLowerCase();
  // Extract a "major.minor" weight, e.g. opus-4-8 → 408, sonnet-4-6 → 406.
  const nums = lower.match(/\d+/g);
  let weight = 0;
  if (nums && nums.length === 1) {
    // Single numeric token is the generation itself → "major.0", e.g. opus-5 → 500.
    weight = parseInt(nums[0] ?? '0', 10) * 100;
  } else if (nums && nums.length > 1) {
    const last = nums[nums.length - 1] ?? '0';
    const prev = nums[nums.length - 2] ?? '0';
    weight = parseInt(prev, 10) * 100 + parseInt(last, 10);
  }
  const isOpus = lower.includes('opus');
  const isSonnet = lower.includes('sonnet');
  const isFable = lower.includes('fable');

  const capable = (isOpus && weight >= 405) || (isSonnet && weight >= 406) || isFable;
  if (!capable) return { supportsEffort: false, supportsFastMode: false, effortLevels: [] };

  const hasXhigh = isFable || (isOpus && weight >= 407) || (isSonnet && weight >= 500);
  const hasMax = isFable || weight >= 406;
  const effortLevels: EffortLevel[] = ['low', 'medium', 'high'];
  if (hasXhigh) effortLevels.push('xhigh');
  if (hasMax) effortLevels.push('max');

  return { supportsEffort: true, supportsFastMode: true, effortLevels };
}

/**
 * The one gate between a stored/requested effort level and the SDK. Returns the
 * level that is safe to send for `modelId`, or `undefined` for "send nothing".
 *
 * - unknown model, or a model with no effort parameter → `undefined`
 * - garbage (a stale enum value from the DB, an unvalidated API body) → `undefined`
 * - a level above the model's ceiling → clamped DOWN to the highest supported
 *   one (so `xhigh` on Sonnet 4.6 runs as `high` instead of failing the request)
 *
 * Clamping rather than dropping keeps the user's intent — "as deep as this model
 * goes" — and keeps the execution audit trail truthful about what actually ran.
 */
export function resolveEffortLevel(
  modelId: string,
  requested: EffortLevel | string | null | undefined,
): EffortLevel | undefined {
  if (!requested || !isEffortLevel(requested)) return undefined;

  const { effortLevels } = inferModelCapabilities(modelId);
  if (effortLevels.length === 0) return undefined;
  if (effortLevels.includes(requested)) return requested;

  const ceiling = effortRank(requested);
  // Walk the canonical ladder downwards for the best level this model accepts.
  for (let rank = ceiling - 1; rank >= 0; rank--) {
    const candidate = EFFORT_LEVELS[rank];
    if (candidate && effortLevels.includes(candidate)) return candidate;
  }
  return undefined;
}

export interface ModelsResponse {
  models: ModelOption[];
  /** true if Anthropic API was unreachable and we returned FALLBACK_MODELS */
  fallback?: boolean;
}

/** Capabilities are derived, never hand-written, so the static list can't drift
 *  out of sync with what `resolveEffortLevel` will actually allow. */
const staticModel = (id: string, label: string, family: ModelFamily): ModelOption => ({
  id,
  label,
  family,
  ...inferModelCapabilities(id),
});

/**
 * Static list used:
 *  - as the immediate fallback when the Anthropic API is unreachable
 *  - as the initial value while /api/models is loading
 *  - as the canonical default order when the dynamic list cannot be filtered
 */
export const FALLBACK_MODELS: ModelOption[] = [
  staticModel('claude-fable-5', 'Claude Fable 5', 'fable'),
  staticModel('claude-opus-5', 'Claude Opus 5', 'opus'),
  staticModel('claude-opus-4-8', 'Claude Opus 4.8', 'opus'),
  staticModel('claude-opus-4-6', 'Claude Opus 4.6', 'opus'),
  staticModel('claude-sonnet-5', 'Claude Sonnet 5', 'sonnet'),
  staticModel('claude-sonnet-4-6', 'Claude Sonnet 4.6', 'sonnet'),
  staticModel('claude-haiku-4-5', 'Claude Haiku 4.5', 'haiku'),
];
