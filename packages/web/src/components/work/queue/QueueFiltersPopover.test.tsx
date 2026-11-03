import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { DEFAULT_QUEUE_FILTERS, type QueueFilters } from '../queueFilters';
import { QueueFiltersPopover } from './QueueFiltersPopover';

afterEach(cleanup);

function open(filters: Partial<QueueFilters> = {}) {
  const onChange = vi.fn();
  render(<QueueFiltersPopover filters={{ ...DEFAULT_QUEUE_FILTERS, ...filters }} onChange={onChange} epics={[]} repos={[]} />);
  fireEvent.click(screen.getByTitle('More filters'));
  return onChange;
}

describe('QueueFiltersPopover — complexity', () => {
  it('picking a "From" bound filters "that value and up"', () => {
    const onChange = open();
    fireEvent.change(screen.getByLabelText('Complexity from'), { target: { value: '8' } });
    expect(onChange).toHaveBeenLastCalledWith({ complexity: { min: '8', max: null, none: false } });
  });

  it('the same value on both bounds is a single-value filter', () => {
    const onChange = open({ complexity: { min: '5', max: null, none: false } });
    fireEvent.change(screen.getByLabelText('Complexity to'), { target: { value: '5' } });
    expect(onChange).toHaveBeenLastCalledWith({ complexity: { min: '5', max: '5', none: false } });
  });

  it('"Not estimated" toggles the unestimated tickets in', () => {
    const onChange = open();
    fireEvent.click(screen.getByRole('button', { name: 'Not estimated' }));
    expect(onChange).toHaveBeenLastCalledWith({ complexity: { min: null, max: null, none: true } });
  });

  it('resetting every part turns the filter off (null), so the view is not "modified" by an empty filter', () => {
    const onChange = open({ complexity: { min: '3', max: null, none: false } });
    fireEvent.change(screen.getByLabelText('Complexity from'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ complexity: null });
  });
});
