import { describe, it, expect } from 'vitest';
import { resolvePanes } from './panesModel';

describe('resolvePanes', () => {
  it('shows exactly what is bound — no auto-fill', () => {
    // Two sessions exist but nothing is bound → every pane is empty.
    expect(resolvePanes(['a', 'b'], 2, [])).toEqual([null, null]);
  });

  it('honours explicit per-pane bindings', () => {
    expect(resolvePanes(['a', 'b', 'c'], 2, ['c', 'a'])).toEqual(['c', 'a']);
  });

  it('leaves a slot empty when its binding is null', () => {
    expect(resolvePanes(['a', 'b'], 2, ['a', null])).toEqual(['a', null]);
  });

  it('drops a binding to a session that no longer exists', () => {
    expect(resolvePanes(['a'], 2, ['gone', 'a'])).toEqual([null, 'a']);
  });

  it('never shows the same session in two panes', () => {
    expect(resolvePanes(['a', 'b'], 2, ['a', 'a'])).toEqual(['a', null]);
  });

  it('pads with empty panes when there are fewer bindings than panes', () => {
    expect(resolvePanes(['a'], 3, ['a'])).toEqual(['a', null, null]);
  });

  it('ignores bindings beyond the pane count', () => {
    expect(resolvePanes(['a', 'b'], 1, ['a', 'b'])).toEqual(['a']);
  });
});
