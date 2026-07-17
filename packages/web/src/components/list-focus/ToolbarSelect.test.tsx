import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { ToolbarMultiSelect } from './ToolbarSelect';

/**
 * Cockpit toolbar dropdowns (#400). Pass 3 introduced popover menus styled like
 * the kanban dropdowns; pass 4 (remark 1) made EVERY filter a multi-select
 * (except the favorites flag), so the single-select variant is gone and the
 * multi-select gained a `zeroLabel` ("All") for filters where an empty
 * selection means "no filtering".
 */

// floating-ui's autoUpdate relies on observers jsdom doesn't implement.
beforeAll(() => {
  class Obs {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', Obs);
  vi.stubGlobal('IntersectionObserver', Obs);
});

afterEach(cleanup);

const statusOptions = [
  { value: 'doing', label: 'Doing' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'done', label: 'Done' },
];

describe('ToolbarMultiSelect', () => {
  it('keeps the menu open across toggles and reports each one (multi-select)', () => {
    const onToggle = vi.fn();
    render(
      <ToolbarMultiSelect label="Status" values={['doing']} options={statusOptions} onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByText('Status'));
    fireEvent.click(screen.getByText('Reviewing'));
    expect(onToggle).toHaveBeenCalledWith('reviewing');
    // Menu must stay open: multi-select means picking several without reopening.
    fireEvent.click(screen.getByText('Done'));
    expect(onToggle).toHaveBeenCalledWith('done');
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('exposes checked state per option (menuitemcheckbox)', () => {
    render(
      <ToolbarMultiSelect
        label="Status"
        values={['doing', 'done']}
        options={statusOptions}
        onToggle={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Status'));
    const items = screen.getAllByRole('menuitemcheckbox');
    const byLabel = Object.fromEntries(items.map((el) => [el.textContent, el.getAttribute('aria-checked')]));
    expect(byLabel['Doing']).toBe('true');
    expect(byLabel['Reviewing']).toBe('false');
    expect(byLabel['Done']).toBe('true');
  });

  it('shows the selected count on the trigger', () => {
    render(
      <ToolbarMultiSelect
        label="Status"
        values={['doing', 'reviewing']}
        options={statusOptions}
        onToggle={() => {}}
      />,
    );
    const trigger = screen.getByText('Status').closest('button');
    expect(trigger?.textContent).toContain('2');
  });

  it('shows the zeroLabel instead of "0" when nothing is selected (empty = all)', () => {
    // WHY: for boards/types/priorities an empty selection means "no filtering",
    // so the trigger must read "All", not a confusing count of 0 (pass 4).
    render(
      <ToolbarMultiSelect
        label="Boards"
        zeroLabel="All"
        values={[]}
        options={statusOptions}
        onToggle={() => {}}
      />,
    );
    const trigger = screen.getByText('Boards').closest('button');
    expect(trigger?.textContent).toContain('All');
    expect(trigger?.textContent).not.toContain('0');
  });
});
