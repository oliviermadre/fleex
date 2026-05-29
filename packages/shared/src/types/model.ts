/**
 * A Claude model exposed in the UI dropdowns.
 * Sourced either from the Anthropic API (dynamic) or from FALLBACK_MODELS.
 */
export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'other';

export interface ModelOption {
  id: string; // e.g. 'claude-opus-4-8'
  label: string; // e.g. 'Claude Opus 4.8'
  family: ModelFamily;
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
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', family: 'opus' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', family: 'opus' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', family: 'sonnet' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', family: 'haiku' },
];
