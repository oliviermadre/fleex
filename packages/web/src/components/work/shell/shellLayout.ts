/**
 * The shell's split layout is one of five presets, chosen only from the tab bar's
 * layout buttons — panes never change the layout themselves. This maps a preset to
 * its pane count; the arrangement (which cell spans what) lives in ShellPanes.
 */
import type { ShellLayout } from '../../../stores/workStore';

export type { ShellLayout };

/** How many panes a layout shows. */
export function paneCount(layout: ShellLayout): number {
  switch (layout) {
    case '1':
      return 1;
    case 'cols':
    case 'rows':
      return 2;
    case 'three':
      return 3;
    case 'grid':
      return 4;
  }
}
