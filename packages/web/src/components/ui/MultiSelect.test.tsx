import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { MultiSelect, type MultiSelectOption } from './MultiSelect';

afterEach(cleanup);

function open(options: MultiSelectOption<string>[]) {
  render(<MultiSelect label="Repos" allLabel="No repo" values={[]} options={options} onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /No repo/ }));
}

describe('MultiSelect — option groups', () => {
  const grouped: MultiSelectOption<string>[] = [
    { value: 'acme/web', label: 'acme/web', group: 'Suggested' },
    { value: 'acme/api', label: 'acme/api', group: 'All repos' },
    { value: 'acme/docs', label: 'acme/docs', group: 'All repos' },
  ];

  it('shows a heading before each group, in order', () => {
    open(grouped);

    const text = document.body.textContent ?? '';
    expect(text.indexOf('Suggested')).toBeLessThan(text.indexOf('acme/web'));
    expect(text.indexOf('acme/web')).toBeLessThan(text.indexOf('All repos'));
    expect(text.indexOf('All repos')).toBeLessThan(text.indexOf('acme/api'));
    expect(screen.getAllByText('All repos')).toHaveLength(1);
  });

  it('drops the heading of a group the search filtered out entirely', () => {
    open(grouped);
    fireEvent.change(screen.getByPlaceholderText('Filter…'), { target: { value: 'api' } });

    expect(screen.queryByText('Suggested')).toBeNull();
    expect(screen.getByText('All repos')).toBeTruthy();
  });

  it('shows no heading for ungrouped options', () => {
    open([{ value: 'acme/web', label: 'acme/web' }]);

    expect(screen.queryByText('Suggested')).toBeNull();
    expect(screen.getByText('acme/web')).toBeTruthy();
  });
});
