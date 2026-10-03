import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { BrowserPanel } from './BrowserPanel';
import { useBrowserStore } from '../../../../stores/browserStore';
import { useToastStore } from '../../../../stores/toastStore';

// jsdom renders <webview> as an HTMLUnknownElement: give it the WebviewTag
// methods the panel uses, so the tab counts as a live (but not yet attached) webview.
const proto = HTMLUnknownElement.prototype as unknown as Record<string, unknown>;
const METHODS = ['getWebContentsId', 'getZoomFactor', 'send', 'loadURL', 'goBack', 'goForward', 'reload'];
let send: ReturnType<typeof vi.fn>;

const ctx = {
  v: 1, page: { url: 'http://x', title: 'x', viewport: { w: 800, h: 600, dpr: 1 } }, tag: 'div',
  rect: { x: 1, y: 1, w: 10, h: 10 }, selector: 'div', xpath: '/div', attributes: {}, styles: {}, html: '<div></div>', siblings: [],
};

function webview(): HTMLElement {
  const el = document.querySelector('webview');
  if (!el) throw new Error('no webview');
  return el as HTMLElement;
}

function fire(name: string, props: Record<string, unknown>) {
  const ev = new Event(name);
  Object.assign(ev, props);
  act(() => { webview().dispatchEvent(ev); });
}

beforeEach(() => {
  send = vi.fn(async () => {});
  proto.getWebContentsId = () => 7;
  proto.getZoomFactor = () => 1;
  proto.send = send;
  proto.loadURL = () => { throw new Error('The WebView must be attached to the DOM'); };
  proto.goBack = vi.fn();
  proto.goForward = vi.fn();
  proto.reload = vi.fn();
  useBrowserStore.setState({
    byTicket: { T1: { tabs: [{ id: 'a', url: 'http://localhost:5173/' }], activeId: 'a' } },
    pendingElements: {},
    expanded: false,
  });
});

afterEach(() => {
  cleanup();
  for (const m of METHODS) delete proto[m];
});

describe('BrowserPanel', () => {
  it('lets pages open pop-ups (main.js turns them into tabs)', () => {
    render(<BrowserPanel ticketId="T1" />);
    expect(webview().getAttribute('allowpopups')).toBe('true');
  });

  it('ignores a pick the user did not ask for', async () => {
    render(<BrowserPanel ticketId="T1" />);
    fire('ipc-message', { channel: 'picker:picked', args: [ctx] });
    await new Promise((r) => setTimeout(r, 0));
    expect(useBrowserStore.getState().pendingElements.T1 ?? []).toEqual([]);
  });

  it('adds a requested pick as a chip, focusing the page first', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    render(<BrowserPanel ticketId="T1" />);
    fireEvent.click(screen.getByTitle('Select an element'));
    expect(send).toHaveBeenCalledWith('picker:start');
    expect(focus).toHaveBeenCalled();
    fire('ipc-message', { channel: 'picker:picked', args: [ctx] });
    await waitFor(() => expect(useBrowserStore.getState().pendingElements.T1).toHaveLength(1));
    focus.mockRestore();
  });

  it('drops a malformed pick payload', async () => {
    render(<BrowserPanel ticketId="T1" />);
    fireEvent.click(screen.getByTitle('Select an element'));
    fire('ipc-message', { channel: 'picker:picked', args: ['junk'] });
    await new Promise((r) => setTimeout(r, 0));
    expect(useBrowserStore.getState().pendingElements.T1 ?? []).toEqual([]);
  });

  it('stops picking when the page reloads or navigates', () => {
    render(<BrowserPanel ticketId="T1" />);
    fireEvent.click(screen.getByTitle('Select an element'));
    expect(screen.getByTitle('Cancel selection (Esc)')).toBeTruthy();
    fire('did-start-navigation', { isMainFrame: true, isInPlace: false });
    expect(screen.getByTitle('Select an element')).toBeTruthy();
  });

  it('navigates through src when the webview is not attached yet', () => {
    render(<BrowserPanel ticketId="T1" />);
    const input = screen.getByPlaceholderText('Type a URL');
    fireEvent.change(input, { target: { value: 'example.com' } });
    fireEvent.submit(input.closest('form')!);
    expect(webview().getAttribute('src')).toBe('https://example.com');
  });

  it('opens exactly one tab for a ticket that has none, even under StrictMode', () => {
    useBrowserStore.setState({ byTicket: {} });
    render(<StrictMode><BrowserPanel ticketId="T2" /></StrictMode>);
    expect(useBrowserStore.getState().byTicket.T2?.tabs).toHaveLength(1);
  });

  it('toasts each pick while expanded (the composer is hidden), with a Show action', async () => {
    useToastStore.setState({ toasts: [] });
    useBrowserStore.setState({ expanded: true });
    render(<BrowserPanel ticketId="T1" />);
    fireEvent.click(screen.getByTitle('Select an element'));
    fire('ipc-message', { channel: 'picker:picked', args: [{ ...ctx, react: { component: 'Card', owners: [] } }] });
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const toast = useToastStore.getState().toasts[0]!;
    expect(toast.message).toBe('<Card /> added to your comment');
    act(() => toast.action!.onClick());
    expect(useBrowserStore.getState().expanded).toBe(false);
  });

  it('does not toast a pick when the composer is visible', async () => {
    useToastStore.setState({ toasts: [] });
    render(<BrowserPanel ticketId="T1" />);
    fireEvent.click(screen.getByTitle('Select an element'));
    fire('ipc-message', { channel: 'picker:picked', args: [ctx] });
    await waitFor(() => expect(useBrowserStore.getState().pendingElements.T1).toHaveLength(1));
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
