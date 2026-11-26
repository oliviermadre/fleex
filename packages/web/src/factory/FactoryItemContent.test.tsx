import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { DeliveredBand, ItemContent, loadsRemote, mailDocument } from './FactoryItemContent';
import type { FactoryRun } from './types';

const itemBody = vi.fn();
vi.mock('./factoryApi', () => ({ factoryApi: { itemBody: (...a: unknown[]) => itemBody(...a) } }));
const openOverlay = vi.fn();
vi.mock('../stores/uiStore', () => ({ useUIStore: (pick: (s: unknown) => unknown) => pick({ openDeliverableOverlay: openOverlay }) }));
vi.mock('../services/api', () => ({ fetchDeliverable: vi.fn(async (id: string) => ({ id, title: `fetched ${id}`, type: 'reply' })) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const HTML = '<div>Bonjour <b>Olivier</b></div><img src="https://track.acme.com/p.gif"><script>alert(1)</script>';

describe('an item\'s content', () => {
  it('builds a mail\'s page that fetches nothing from the internet until images are asked for', () => {
    expect(loadsRemote(HTML)).toBe(true);
    expect(loadsRemote('<div style="background:url(data:image/png;base64,AA)">x</div>')).toBe(false);
    expect(loadsRemote('<td background="https://x.com/b.png">')).toBe(true);
    const off = mailDocument(HTML, false), on = mailDocument(HTML, true);
    expect(off).toContain("img-src data: cid:\"");
    expect(off).toContain("default-src 'none'");
    expect(off).toContain('<base target="_blank">');
    expect(on).toContain('img-src https: http: data: cid:');
  });

  it('a mail: its whole text read only, and its HTML in a sandboxed frame, images held back until asked', async () => {
    itemBody.mockResolvedValueOnce({ text: 'Bonjour Olivier,\nla facture', html: HTML, kept: true });
    render(<ItemContent itemId="i1" excerpt="Bonjour" version="v1" onEdit={vi.fn()} />);
    expect((await screen.findByLabelText('Its text')).textContent).toBe('Bonjour Olivier,\nla facture');
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Email' }));
    const frame = screen.getByTitle('The mail as it was sent') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox');      // no scripts
    expect(frame.getAttribute('srcdoc')).toContain("img-src data: cid:");
    fireEvent.click(screen.getByRole('button', { name: 'Load images' }));
    expect((screen.getByTitle('The mail as it was sent') as HTMLIFrameElement).getAttribute('srcdoc')).toContain('img-src https:');
    expect(screen.queryByRole('button', { name: 'Load images' })).toBeNull();
  });

  it('an item made by hand: no Email tab, and its text can be changed', async () => {
    itemBody.mockResolvedValueOnce({ text: 'by hand', html: null, kept: false });
    const onEdit = vi.fn();
    render(<ItemContent itemId="i2" excerpt="by hand" version="v1" onEdit={onEdit} />);
    const box = await screen.findByLabelText('Text');
    expect(screen.queryByRole('tab', { name: 'Email' })).toBeNull();
    fireEvent.change(box, { target: { value: 'changed' } });
    fireEvent.blur(box);
    expect(onEdit).toHaveBeenCalledWith('changed');
  });
});

describe('what an item delivered', () => {
  const run = (id: string, deliverableId: string): FactoryRun => ({ id, ticketId: 'i1', machineId: 'm', machineName: 'Answer mail', executor: 'agent', status: 'completed', outcome: 'ok', executionId: null, error: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), deliverableId } as FactoryRun);

  it('is a band of cards to open, and nothing when there is none', async () => {
    const { container } = render(<DeliveredBand delivered={[]} />);
    expect(container.textContent).toBe('');
    render(<DeliveredBand delivered={[{ run: run('r1', 'd1'), deliverable: { id: 'd1', title: 'Draft reply', type: 'reply' } as never }, { run: run('r2', 'd2'), deliverable: null }]} />);
    const band = screen.getByRole('region', { name: 'Delivered' });
    expect(band.textContent).toContain('Delivered · 2');
    expect(band.textContent).toContain('Draft reply');
    expect(band.textContent).toContain('by Answer mail');
    const opens = screen.getAllByRole('button', { name: 'Open' });
    fireEvent.click(opens[0]!);
    expect(openOverlay).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));
    fireEvent.click(opens[1]!);
    await waitFor(() => expect(openOverlay).toHaveBeenCalledWith(expect.objectContaining({ id: 'd2', title: 'fetched d2' })));
  });
});
