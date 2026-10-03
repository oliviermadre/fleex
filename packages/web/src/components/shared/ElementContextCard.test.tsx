import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ElementContextCard } from './ElementContextCard';
import type { ElementContext } from './elementContext';

afterEach(cleanup);

const base: ElementContext = {
  v: 1,
  page: { url: 'http://localhost:5173/', title: 'x', viewport: { w: 1, h: 1, dpr: 1 } },
  tag: 'button', rect: { x: 0, y: 0, w: 10, h: 10 },
  selector: '#save', xpath: '//*[@id="save"]', text: 'Save',
  attributes: { id: 'save' }, styles: { color: 'rgb(0, 0, 0)' },
  html: '<button id="save">Save</button>', siblings: [{ tag: 'button', selected: true }],
};

describe('ElementContextCard', () => {
  it('renders component and source when React info is present', () => {
    render(<ElementContextCard context={{ ...base, react: { component: 'SaveButton', owners: ['Toolbar', 'App'], source: { file: '/src/Toolbar.tsx', line: 12, column: 5 } } }} />);
    expect(screen.getByText('<SaveButton />')).toBeTruthy();
    expect(screen.getByText('SaveButton in Toolbar › App')).toBeTruthy();
    expect(screen.getByText('/src/Toolbar.tsx:12:5')).toBeTruthy();
  });

  it('renders a plain element without React rows', () => {
    render(<ElementContextCard context={base} />);
    expect(screen.getByText('<button>')).toBeTruthy();
    expect(screen.queryByText('Component')).toBeNull();
    expect(screen.queryByText('Source')).toBeNull();
  });

  it('reveals selector, styles and html behind "Show details"', () => {
    render(<ElementContextCard context={base} />);
    expect(screen.queryByText('#save')).toBeNull();
    fireEvent.click(screen.getByText('Show details'));
    expect(screen.getByText('#save')).toBeTruthy();
    expect(screen.getByText('<button id="save">Save</button>')).toBeTruthy();
  });
});

import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { serializeElement } from './elementContext';

describe('MarkdownRenderer + fleex-element', () => {
  it('renders the block as a card, not as code', () => {
    const body = serializeElement({ id: 'x', context: base });
    render(<MarkdownRenderer content={body} onToggleCheckbox={() => {}} />);
    expect(screen.getByText('<button>')).toBeTruthy();
    expect(screen.getByText('Show details')).toBeTruthy();
  });
});
