import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { ActivityHeatmap } from './statCandidates';

/**
 * WHY: the heatmap is read as "when do *I* work". An hourly routine lit every
 * night cell and made it useless, so scheduler-launched runs are hidden by
 * default and only come back when the user opts in.
 */
describe('ActivityHeatmap', () => {
  afterEach(cleanup);

  // Monday 03:00 — only a cron run; Monday 10:00 — the user, plus one cron run.
  const data = [
    { dow: 1, hour: 3, count: 0, scheduledCount: 4 },
    { dow: 1, hour: 10, count: 2, scheduledCount: 1 },
  ];

  it('hides scheduled routine runs by default', () => {
    render(<ActivityHeatmap data={data} />);
    expect(screen.getByTitle('Mon 3:00 — 0 runs')).toBeTruthy();
    expect(screen.getByTitle('Mon 10:00 — 2 runs')).toBeTruthy();
  });

  it('adds them back, attributed, when routines are included', () => {
    render(<ActivityHeatmap data={data} includeRoutines />);
    expect(screen.getByTitle('Mon 3:00 — 4 runs (4 by scheduled routines)')).toBeTruthy();
    expect(screen.getByTitle('Mon 10:00 — 3 runs (1 by scheduled routines)')).toBeTruthy();
  });

  it('shows the empty state when only routines ran and they are hidden', () => {
    render(<ActivityHeatmap data={[{ dow: 1, hour: 3, count: 0, scheduledCount: 4 }]} />);
    expect(screen.getByText('No agent activity to map')).toBeTruthy();
  });
});
