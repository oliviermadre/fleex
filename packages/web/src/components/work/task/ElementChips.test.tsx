import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ElementChips } from './ElementChips';
import { useBrowserStore } from '../../../stores/browserStore';
import type { ElementContext } from '../../shared/elementContext';

const context: ElementContext = {
  v: 1, page: { url: 'http://x', title: 'x', viewport: { w: 1, h: 1, dpr: 1 } }, tag: 'div',
  rect: { x: 0, y: 0, w: 1, h: 1 }, selector: 'div', xpath: '/div', text: 'Hello',
  attributes: {}, styles: {}, html: '<div>Hello</div>', siblings: [],
  react: { component: 'Toast', owners: ['App'] },
};

beforeEach(() => useBrowserStore.setState({ pendingElements: { T1: [{ id: 'e1', context, captureFailed: true }] } }));
afterEach(cleanup);

describe('ElementChips', () => {
  it('shows a chip per pending element, opens its card, and removes it', () => {
    render(<ElementChips ticketId="T1" />);
    fireEvent.click(screen.getByText('<Toast /> Hello'));
    expect(screen.getByText('Included with your message')).toBeTruthy();
    expect(screen.getByText('Screenshot unavailable')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Remove'));
    expect(useBrowserStore.getState().pendingElements.T1).toEqual([]);
  });

  it('renders nothing without pending elements', () => {
    const { container } = render(<ElementChips ticketId="T2" />);
    expect(container.innerHTML).toBe('');
  });
});
