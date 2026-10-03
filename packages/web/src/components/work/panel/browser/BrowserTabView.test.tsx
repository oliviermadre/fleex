import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BrowserTabView } from './BrowserTabView';

afterEach(cleanup);

describe('BrowserTabView', () => {
  it('says to restart the desktop app when <webview> is not enabled', () => {
    // jsdom (like Electron without webviewTag) renders <webview> as an unknown
    // element, without the WebviewTag methods.
    render(
      <BrowserTabView
        tab={{ id: 't1', url: 'https://example.com' }}
        active
        onReady={vi.fn()}
        onUpdate={vi.fn()}
        onPicked={vi.fn()}
        onPickCancelled={vi.fn()}
        onNavigateStart={vi.fn()}
      />,
    );
    expect(screen.getByText('Restart the Fleex desktop app to enable the browser.')).toBeTruthy();
  });
});
