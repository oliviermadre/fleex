/**
 * The version of a floor's layout, and what to do with a layout of an earlier one.
 *
 * A layout is a JSON document the page and the engine both read. When what it means changes, its version goes up by
 * one and a step is added here, as a migration is added for a table. Two kinds of step:
 *
 * - a change of shape (a property renamed, a new one that needs a default) is converted: the step returns the layout
 *   rewritten;
 * - a change of geometry (machines that take more room, so that what was built around them no longer fits) cannot be
 *   converted without redoing the floor: the step returns null. The engine then keeps the old layout as an archived
 *   floor, starts from an empty one, and sends the tickets back to Inbound.
 *
 * Steps are applied in order when the floor is loaded, so a floor several versions behind goes through each of them.
 */
import type { FactoryLayout } from './types.js';

export const LAYOUT_VERSION = 2;

type Step = (layout: FactoryLayout) => FactoryLayout | null;

/** `STEPS[n]` takes a layout of version n - 1 to version n. */
const STEPS: Record<number, Step> = {
  /* 2: stations are drawn as machines with places, a tray and a bay, and take 5 by 4 tiles instead of 3 by 3 */
  2: () => null,
};

/** A layout saved before versions existed is version 1. */
export const versionOf = (layout: FactoryLayout): number => (Number.isInteger(layout.version) && layout.version! > 0 ? layout.version! : 1);

/**
 * Bring a layout to the current version. `layout` is null when a step on the way could not convert it; `from` is the
 * version it was at. A layout from a newer server than this one is left as it is.
 */
export function upgradeLayout(input: FactoryLayout, steps: Record<number, Step> = STEPS, target = LAYOUT_VERSION): { layout: FactoryLayout | null; from: number } {
  const from = versionOf(input);
  let layout: FactoryLayout | null = input;
  for (let v = from + 1; v <= target && layout; v++) {
    const step = steps[v];
    layout = step ? step(layout) : layout;
    if (layout) layout = { ...layout, version: v };
  }
  return { layout, from };
}
