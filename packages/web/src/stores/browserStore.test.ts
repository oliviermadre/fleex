import { describe, it, expect, beforeEach } from 'vitest';
import { useBrowserStore } from './browserStore';
import type { PendingElement } from '../components/shared/elementContext';

const reset = () => useBrowserStore.setState({ byTicket: {}, pendingElements: {}, expanded: false, composerFocusTick: 0 });

describe('browserStore', () => {
  beforeEach(() => { localStorage.clear(); reset(); });

  it('opens, updates, activates and closes tabs per ticket', () => {
    const s = useBrowserStore.getState();
    const a = s.openTab('T1', 'http://a');
    const b = s.openTab('T1');
    expect(useBrowserStore.getState().byTicket.T1?.activeId).toBe(b);
    s.updateTab('T1', b, { url: 'http://b', title: 'B' });
    s.closeTab('T1', b);
    const t1 = useBrowserStore.getState().byTicket.T1!;
    expect(t1.tabs.map((t) => t.id)).toEqual([a]);
    expect(t1.activeId).toBe(a);
    expect(useBrowserStore.getState().byTicket.T2).toBeUndefined();
  });

  it('persists tabs but not pending elements', () => {
    const s = useBrowserStore.getState();
    s.openTab('T1', 'http://a');
    s.addElement('T1', { id: 'e', context: {} as PendingElement['context'] });
    const saved = JSON.parse(localStorage.getItem('fleex_browser') ?? '{}');
    expect(saved.byTicket.T1.tabs[0].url).toBe('http://a');
    expect(saved.pendingElements).toBeUndefined();
  });

  it('adds, removes and clears pending elements', () => {
    const s = useBrowserStore.getState();
    s.addElement('T1', { id: 'e1', context: {} as PendingElement['context'] });
    s.addElement('T1', { id: 'e2', context: {} as PendingElement['context'] });
    s.removeElement('T1', 'e1');
    expect(useBrowserStore.getState().pendingElements.T1?.map((e) => e.id)).toEqual(['e2']);
    s.clearElements('T1');
    expect(useBrowserStore.getState().pendingElements.T1).toEqual([]);
  });
});
