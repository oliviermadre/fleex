import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import type { TicketDeliverable } from '@fleex/shared';

vi.mock('../components/scratchpad/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <p data-testid="markdown">{content}</p>,
}));
vi.mock('../services/api', async (orig) => ({
  ...(await orig<typeof import('../services/api')>()),
  toggleDeliverableSeen: vi.fn().mockResolvedValue(undefined),
}));

import { useUIStore } from '../stores/uiStore';
import { MobileDeliverableReader, MobileDeliverableOverlayHost } from './MobileDeliverableReader';

afterEach(() => {
  cleanup();
  useUIStore.setState({ deliverableOverlay: null });
});

const deliverable = (over: Partial<TicketDeliverable>): TicketDeliverable => ({
  id: 'd1', ticketId: 't1', agentName: 'cli', type: 'report', title: 'Maquette', content: '# hi',
  version: 1, status: 'final', mentionId: null, createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z',
  ...over,
});

describe('MobileDeliverableReader', () => {
  it('plays an HTML mockup in an iframe instead of dumping its source as markdown text', () => {
    const html = '<!DOCTYPE html><html><head><style>:root{--bg:#000}</style></head><body>ok</body></html>';
    render(<MobileDeliverableReader ticketId="t1" deliverable={deliverable({ type: 'html', content: html })} onClose={() => {}} />);
    const frame = screen.getByTitle('Maquette') as HTMLIFrameElement;
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('srcdoc')).toBe(html);
    expect(screen.queryByTestId('markdown')).toBeNull();
  });

  it('still renders non-HTML deliverables as markdown', () => {
    render(<MobileDeliverableReader ticketId="t1" deliverable={deliverable({})} onClose={() => {}} />);
    expect(screen.getByTestId('markdown').textContent).toBe('# hi');
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('MobileDeliverableOverlayHost', () => {
  it('opens the reader when a shared deliverable card (Focus thread) asks the uiStore to — the desktop overlay is not mounted on the phone', () => {
    render(<MobileDeliverableOverlayHost />);
    expect(screen.queryByText('Maquette')).toBeNull();

    act(() => useUIStore.getState().openDeliverableOverlay(deliverable({})));
    expect(screen.getByText('Maquette')).toBeTruthy();

    act(() => screen.getByLabelText('Fermer').click());
    expect(screen.queryByText('Maquette')).toBeNull();
  });
});
