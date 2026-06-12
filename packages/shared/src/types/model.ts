/**
 * A Claude model exposed in the UI dropdowns.
 * Sourced either from the Anthropic API (dynamic) or from FALLBACK_MODELS.
 */
export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'other';

export interface ModelOption {
  id: string; // e.g. 'claude-opus-4-8'
  label: string; // e.g. 'Claude Opus 4.8'
  family: ModelFamily;
  /** Whether the model accepts a reasoning-effort level (low/medium/high…). */
  supportsEffort?: boolean;
  /** Whether the model supports a low-latency "fast mode". */
  supportsFastMode?: boolean;
}

/**
 * Best-effort capability inference from a model id, used as a fallback when the
 * Anthropic API does not advertise capabilities. Effort & fast mode landed with
 * the Opus 4.5 / Sonnet 4.6 generation. Conservative: unknown/older models get
 * `false`, so the UI simply hides the control (graceful degradation) rather than
 * sending an unsupported option to the SDK.
 */
export function inferModelCapabilities(id: string): { supportsEffort: boolean; supportsFastMode: boolean } {
  const lower = id.toLowerCase();
  // Extract a "major.minor" weight, e.g. opus-4-8 → 408, sonnet-4-6 → 406.
  const nums = lower.match(/\d+/g);
  let weight = 0;
  if (nums && nums.length >= 1) {
    const last = nums[nums.length - 1] ?? '0';
    const prev = nums.length > 1 ? nums[nums.length - 2] ?? '0' : '0';
    weight = parseInt(prev, 10) * 100 + parseInt(last, 10);
  }
  const isOpus = lower.includes('opus');
  const isSonnet = lower.includes('sonnet');
  // Opus ≥ 4.5 and Sonnet ≥ 4.6 expose effort + fast mode.
  const capable = (isOpus && weight >= 405) || (isSonnet && weight >= 406);
  return { supportsEffort: capable, supportsFastMode: capable };
}

export interface ModelsResponse {
  models: ModelOption[];
  /** true if Anthropic API was unreachable and we returned FALLBACK_MODELS */
  fallback?: boolean;
}

/**
 * Static list used:
 *  - as the immediate fallback when the Anthropic API is unreachable
 *  - as the initial value while /api/models is loading
 *  - as the canonical default order when the dynamic list cannot be filtered
 */
export const FALLBACK_MODELS: ModelOption[] = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', family: 'opus', supportsEffort: true, supportsFastMode: true },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', family: 'opus', supportsEffort: true, supportsFastMode: true },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', family: 'sonnet', supportsEffort: true, supportsFastMode: true },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', family: 'haiku', supportsEffort: false, supportsFastMode: false },
];
