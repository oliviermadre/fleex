import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { ToolbarSelect, ToolbarMultiSelect } from './ToolbarSelect';

/**
 * Cockpit toolbar dropdowns (#400, review pass 3, remark 1): the native
 * <select>s were "moches" — they must be popover menus styled like the kanban
 * dropdowns (BoardSelectorDropdown / FilterDropdown), carry an icon per option
 * (type emoji, priority picto, board emoji, status dot), and the status scope
 * becomes a MULTI-select dropdown instead of a row of chips.
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

const typeOptions = [
  { value: 'build', label: 'Build', icon: <span>🔨</span> },
  { value: 'fix', label: 'Fix', icon: <span>🐛</span> },
];

describe('ToolbarSelect (single)', () => {
  it('shows the allLabel when empty and opens a menu with icon + label options', () => {
    render(<ToolbarSelect allLabel="All types" value={null} options={typeOptions} onChange={() => {}} />);
    expect(screen.getByText('All types')).not.toBeNull();
    expect(screen.queryByText('Fix')).toBeNull(); // closed by default

    fireEvent.click(screen.getByText('All types'));
    expect(screen.getByText('Fix')).not.toBeNull();
    expect(screen.getByText('🐛')).not.toBeNull(); // option icon (remark 1)
  });

  it('selecting an option reports its value and closes the menu', () => {
    const onChange = vi.fn();
    render(<ToolbarSelect allLabel="All types" value={null} options={typeOptions} onChange={onChange} />);
    fireEvent.click(screen.getByText('All types'));
    fireEvent.click(screen.getByText('Fix'));
    expect(onChange).toHaveBeenCalledWith('fix');
    expect(screen.queryByText('Build')).toBeNull(); // menu closed
  });

  it('offers an "All" entry that clears the filter', () => {
    const onChange = vi.fn();
    render(<ToolbarSelect allLabel="All types" value="fix" options={typeOptions} onChange={onChange} />);
    // Trigger shows the selection, so "All types" only exists inside the menu.
    fireEvent.click(screen.getByText('Fix'));
    fireEvent.click(screen.getByText('All types'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('renders the selected option (icon + label) on the trigger', () => {
    render(<ToolbarSelect allLabel="All types" value="fix" options={typeOptions} onChange={() => {}} />);
    expect(screen.getByText('Fix')).not.toBeNull();
    expect(screen.getByText('🐛')).not.toBeNull();
    expect(screen.queryByText('All types')).toBeNull();
  });
});

const statusOptions = [
  { value: 'doing', label: 'Doing' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'done', label: 'Done' },
];

describe('ToolbarMultiSelect (status scope)', () => {
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
});
