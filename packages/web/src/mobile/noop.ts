/**
 * Stable no-op for `MarkdownRenderer.onToggleCheckbox`. An inline `() => {}` is
 * a new function on every render, which defeats the renderer's `memo()` and
 * re-parses every message on each keystroke of a sibling composer.
 */
export const NOOP = () => {};
