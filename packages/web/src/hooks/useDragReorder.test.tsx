import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import type { DragEvent as ReactDragEvent } from 'react';
import { useDragReorder } from './useDragReorder';

const MIME = 'application/x-test-item';

type Item = { id: string; label: string };
type Api = ReturnType<typeof useDragReorder<Item>>;

/**
 * Headless harness: surfaces the hook's return value onto a mutable ref so
 * tests can invoke `getDragProps` handlers directly and read state after each
 * `act()`. jsdom does not implement a usable DataTransfer for drag events, so
 * we drive the (real) hook logic with fabricated event objects — the one
 * unavoidable mock.
 */
function Harness({
  items,
  onReorder,
  mimeType,
  apiRef,
}: {
  items: Item[];
  onReorder: (items: Item[]) => void;
  mimeType: string;
  apiRef: { current: Api | null };
}) {
  apiRef.current = useDragReorder<Item>({ items, onReorder, mimeType });
  return null;
}

function makeDataTransfer(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    effectAllowed: '' as string,
    dropEffect: '' as string,
    get types(): string[] {
      return Object.keys(store);
    },
    setData(type: string, val: string) {
      store[type] = val;
    },
    getData(type: string): string {
      return store[type] ?? '';
    },
  };
}

function makeTarget(opts: { top?: number; height?: number; contains?: (n: unknown) => boolean } = {}) {
  return {
    getBoundingClientRect: () => ({ top: opts.top ?? 0, height: opts.height ?? 100 }),
    style: {} as { opacity?: string },
    contains: opts.contains ?? (() => false),
  };
}

function makeEvent(
  overrides: {
    dataTransfer?: ReturnType<typeof makeDataTransfer>;
    currentTarget?: ReturnType<typeof makeTarget>;
    clientY?: number;
    relatedTarget?: unknown;
  } = {}
) {
  const evt = {
    preventDefault: vi.fn(),
    dataTransfer: overrides.dataTransfer ?? makeDataTransfer(),
    currentTarget: overrides.currentTarget ?? makeTarget(),
    clientY: overrides.clientY ?? 0,
    relatedTarget: overrides.relatedTarget ?? null,
  };
  return evt as unknown as ReactDragEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

function setup(items: Item[]) {
  const onReorder = vi.fn();
  const apiRef: { current: Api | null } = { current: null };
  render(<Harness items={items} onReorder={onReorder} mimeType={MIME} apiRef={apiRef} />);
  return {
    onReorder,
    apiRef,
    api: () => apiRef.current!,
  };
}

/** Simulate hovering an item so `dragOverId`/`dropEdge` reflect the edge. */
function hover(api: () => Api, id: string, edge: 'top' | 'bottom') {
  act(() => {
    api()
      .getDragProps(id)
      .onDragOver(
        makeEvent({
          dataTransfer: makeDataTransfer({ [MIME]: 'seed' }),
          currentTarget: makeTarget({ top: 0, height: 100 }),
          clientY: edge === 'top' ? 10 : 80,
        })
      );
  });
}

afterEach(() => cleanup());

describe('useDragReorder', () => {
  it('marks elements as draggable', () => {
    const { api } = setup([{ id: 'a', label: 'A' }]);
    expect(api().getDragProps('a').draggable).toBe(true);
  });

  it('onDragStart flags a move, stores the id under the mime type, and dims the source', () => {
    const { api } = setup([{ id: 'a', label: 'A' }]);
    const dt = makeDataTransfer();
    const target = makeTarget();
    act(() => api().getDragProps('a').onDragStart(makeEvent({ dataTransfer: dt, currentTarget: target })));
    expect(dt.effectAllowed).toBe('move');
    expect(dt.getData(MIME)).toBe('a');
    expect(target.style.opacity).toBe('0.4');
  });

  it('onDragEnd clears the drop indicator and restores opacity', () => {
    const { api } = setup([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    hover(api, 'b', 'top');
    expect(api().dragOverId).toBe('b');
    const endTarget = makeTarget();
    endTarget.style.opacity = '0.4';
    act(() => api().getDragProps('a').onDragEnd(makeEvent({ currentTarget: endTarget })));
    expect(api().dragOverId).toBeNull();
    expect(endTarget.style.opacity).toBe('');
  });

  it('onDragOver above the midpoint selects the top edge, marks the id, and enables the drop', () => {
    const { api } = setup([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    const dt = makeDataTransfer({ [MIME]: 'a' });
    const e = makeEvent({ dataTransfer: dt, currentTarget: makeTarget({ top: 0, height: 100 }), clientY: 10 });
    act(() => api().getDragProps('b').onDragOver(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(dt.dropEffect).toBe('move');
    expect(api().dropEdge).toBe('top');
    expect(api().dragOverId).toBe('b');
  });

  it('onDragOver below the midpoint selects the bottom edge', () => {
    const { api } = setup([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    const e = makeEvent({
      dataTransfer: makeDataTransfer({ [MIME]: 'a' }),
      currentTarget: makeTarget({ top: 0, height: 100 }),
      clientY: 80,
    });
    act(() => api().getDragProps('b').onDragOver(e));
    expect(api().dropEdge).toBe('bottom');
  });

  it('onDragOver ignores a drag whose payload lacks the configured mime type (list isolation)', () => {
    const { api } = setup([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    const e = makeEvent({
      dataTransfer: makeDataTransfer({ 'application/x-other-list': 'a' }),
      currentTarget: makeTarget(),
      clientY: 10,
    });
    act(() => api().getDragProps('b').onDragOver(e));
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(api().dragOverId).toBeNull();
  });

  it('onDragLeave keeps the indicator when leaving into a child element', () => {
    const { api } = setup([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    hover(api, 'b', 'top');
    expect(api().dragOverId).toBe('b');
    act(() => api().getDragProps('b').onDragLeave(makeEvent({ currentTarget: makeTarget({ contains: () => true }) })));
    expect(api().dragOverId).toBe('b');
  });

  it('onDragLeave clears the indicator when leaving the hovered item entirely', () => {
    const { api } = setup([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    hover(api, 'b', 'top');
    expect(api().dragOverId).toBe('b');
    act(() => api().getDragProps('b').onDragLeave(makeEvent({ currentTarget: makeTarget({ contains: () => false }) })));
    expect(api().dragOverId).toBeNull();
  });

  it('drops the item AFTER the target when the bottom edge is active', () => {
    const { api, onReorder } = setup([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ]);
    hover(api, 'b', 'bottom');
    act(() => api().getDragProps('b').onDrop(makeEvent({ dataTransfer: makeDataTransfer({ [MIME]: 'a' }) })));
    expect(onReorder).toHaveBeenCalledTimes(1);
    const reordered = onReorder.mock.calls[0]![0] as Item[];
    expect(reordered.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('drops the item BEFORE the target when the top edge is active', () => {
    const { api, onReorder } = setup([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ]);
    hover(api, 'a', 'top');
    act(() => api().getDragProps('a').onDrop(makeEvent({ dataTransfer: makeDataTransfer({ [MIME]: 'c' }) })));
    expect(onReorder).toHaveBeenCalledTimes(1);
    const reordered = onReorder.mock.calls[0]![0] as Item[];
    expect(reordered.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('does nothing when an item is dropped onto itself', () => {
    const { api, onReorder } = setup([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    act(() => api().getDragProps('a').onDrop(makeEvent({ dataTransfer: makeDataTransfer({ [MIME]: 'a' }) })));
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('does nothing when the drop payload carries no dragged id', () => {
    const { api, onReorder } = setup([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    act(() => api().getDragProps('a').onDrop(makeEvent({ dataTransfer: makeDataTransfer() })));
    expect(onReorder).not.toHaveBeenCalled();
  });
});
