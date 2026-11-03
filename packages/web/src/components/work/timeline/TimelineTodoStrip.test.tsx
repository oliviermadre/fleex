/**
 * The todo strip of the frieze (ticket « todo for ticket », nas: "voir quand
 * sont créés et passent en done/cancelled les items… many in a short time
 * range → une icône avec un compteur, un hover comme pour les annotations").
 * A ticket that does not use the todo must keep its timeline untouched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { TicketTimeline, type TimelineTodosProps } from './TicketTimeline';
import { buildTimeline } from './buildTimeline';
import { NOW, at, fixture591 } from './timeline.fixture';
import { GEOMETRY } from './layoutTimeline';
import { TODO_STRIP, layoutTodoStrip } from './layoutTodoStrip';
import { TodoMarksPopover } from './TodoMarksPopover';
import type { TodoMark, TodoMarkKind } from './todoMarks';

afterEach(cleanup);

const GLYPH = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
const ALL = { status: true, cli: true, pr: true, deliverables: true, comments: true, annotations: true, todos: true };
const header = { number: 591, title: 'Importer une tâche depuis Slack', boardName: 'Fleex', status: 'doing', type: 'build' };

const mark = (i: number, atIso: string, kind: TodoMarkKind = 'created', over: Partial<TodoMark> = {}): TodoMark => ({
  id: `m${i}`, itemId: `i${i}`, ref: i, kind, at: Date.parse(atIso) + i * 100, itemText: `Item ${i}`,
  actorType: 'agent', actorName: 'Catalyst', source: 'cli', reason: null, deleted: false, ...over,
});

/** 8 items seeded by the Catalyst in one `--file`, then the Builder's 3 done + 1 cancel. */
const MARKS: TodoMark[] = [
  ...Array.from({ length: 8 }, (_, i) => mark(i + 1, at(9, 5))),
  mark(21, at(10, 20), 'done', { actorName: 'Builder' }),
  mark(22, at(10, 20), 'done', { actorName: 'Builder' }),
  mark(23, at(10, 20), 'done', { actorName: 'Builder' }),
  mark(24, at(10, 20), 'cancelled', { actorName: 'Builder', reason: 'couvert par #3' }),
];

function setup(marks: TodoMark[], filters = ALL, over: Partial<TimelineTodosProps> = {}) {
  const todos: TimelineTodosProps = { marks, activeKey: null, pinnedKey: null, onOpenChip: vi.fn(), onHoverChip: vi.fn(), ...over };
  const onContentHeight = vi.fn();
  render(
    <TicketTimeline
      header={header}
      model={buildTimeline(fixture591(), NOW)}
      filters={filters}
      onToggleFilter={vi.fn()}
      onAction={vi.fn()}
      todos={todos}
      onContentHeight={onContentHeight}
    />,
  );
  return { todos, onContentHeight };
}

const pictoPositions = () =>
  [...document.querySelectorAll<HTMLElement>('[data-timeline-node]')]
    .filter((n) => !n.dataset.timelineNode!.startsWith('todo:'))
    .map((n) => `${n.dataset.timelineNode}@${n.style.left}`);

describe('TicketTimeline — todo strip', () => {
  it('has no strip, and no extra height, on a ticket without todo history', () => {
    const { onContentHeight } = setup([]);
    expect(screen.queryByTestId('todo-strip')).toBeNull();
    expect(onContentHeight).toHaveBeenLastCalledWith(GEOMETRY.height);
  });

  it('draws the strip under the frieze, and adds its height', () => {
    const { onContentHeight } = setup(MARKS);
    expect(screen.getByTestId('todo-strip-label').textContent).toBe('Todo');
    expect(onContentHeight).toHaveBeenLastCalledWith(GEOMETRY.height + TODO_STRIP);
  });

  it('never moves a picto of the frieze, nor widens it', () => {
    setup([]);
    const before = pictoPositions();
    const width = screen.getByTestId('timeline-content').style.width;
    cleanup();
    setup(MARKS);
    expect(pictoPositions()).toEqual(before);
    expect(screen.getByTestId('timeline-content').style.width).toBe(width);
  });

  it('turns each burst into one counted chip', () => {
    setup(MARKS);
    const chips = screen.getAllByTestId('todo-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0]!.textContent).toBe('8');
    expect(chips[0]!.getAttribute('aria-label')).toMatch(/8 créés/);
    expect(chips[1]!.textContent).toBe('31');
    expect(chips[1]!.getAttribute('aria-label')).toMatch(/3 faits, 1 annulé/);
  });

  it('hides the strip and gives its height back when the Todo filter is off', () => {
    const { onContentHeight } = setup(MARKS, { ...ALL, todos: false });
    expect(screen.queryByTestId('todo-strip')).toBeNull();
    expect(onContentHeight).toHaveBeenLastCalledWith(GEOMETRY.height);
  });

  it('reports hover and click on a chip to the host', () => {
    const { todos } = setup(MARKS);
    const chip = screen.getAllByTestId('todo-chip')[1]!;
    fireEvent.mouseEnter(chip);
    expect(todos.onHoverChip).toHaveBeenCalledWith(expect.objectContaining({ counts: { done: 3, cancelled: 1 } }), expect.anything());
    fireEvent.click(chip);
    expect(todos.onOpenChip).toHaveBeenCalled();
  });

  it('draws the dotted lines to the lifeline only for the open chip', () => {
    setup(MARKS);
    expect(screen.queryByTestId('todo-hover-lines')).toBeNull();
    cleanup();
    setup(MARKS, ALL, { activeKey: 'm21' });
    expect(screen.getByTestId('todo-hover-lines')).toBeTruthy();
  });

  // nas: every item of the timeline hangs from it by a dotted line; the todo chips must too.
  it('hangs every chip from the lifeline at rest, like every other picto', () => {
    setup(MARKS);
    const chips = screen.getAllByTestId('todo-chip');
    expect(screen.getAllByTestId('todo-anchor')).toHaveLength(chips.length);
  });

  it("marks a burst's time span on the spine, and a lone event's exact instant", () => {
    // 8 creations spread over 7 minutes (one chip), then one isolated done much later.
    const spread = Array.from({ length: 8 }, (_, i) => mark(i + 1, at(9, 5 + i)));
    setup([...spread, mark(30, at(11, 30), 'done', { actorName: 'Builder' })]);
    // Every burst spanning time gets a bar as wide as its span (the layout may split 7 minutes in two).
    const spans = screen.getAllByTestId('todo-anchor-span');
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) expect(Number(span.getAttribute('width'))).toBeGreaterThan(4);
    expect(screen.getAllByTestId('todo-anchor-dot')).toHaveLength(1);
  });

  it('draws the quiet anchors under the frieze, so they never cover a picto or its label', () => {
    setup(MARKS);
    const anchor = screen.getAllByTestId('todo-anchor')[0]!;
    const picto = document.querySelector('[data-timeline-node]:not([data-timeline-node^="todo:"])')!;
    // Earlier in the DOM = painted first = underneath.
    expect(anchor.compareDocumentPosition(picto) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('swaps the quiet anchor for the strong hover lines on the open chip', () => {
    setup(MARKS, ALL, { activeKey: 'm21' });
    expect(screen.getAllByTestId('todo-anchor')).toHaveLength(screen.getAllByTestId('todo-chip').length - 1);
    expect(screen.getByTestId('todo-hover-lines')).toBeTruthy();
  });

  it('lets the arrow keys walk from the frieze pictos onto the chips', () => {
    setup(MARKS);
    const chips = screen.getAllByTestId('todo-chip');
    chips[0]!.focus();
    fireEvent.keyDown(chips[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).not.toBe(chips[0]);
    expect((document.activeElement as HTMLElement).dataset.timelineNode).toBeTruthy();
  });

  // nas: on a single-event pill the translucent tint let the dashed baseline show through,
  // and the solid-tone check on its pale background read as a blot.
  it('paints a single-event pill opaque, its glyph in the tint text tone', () => {
    setup([mark(1, at(10, 20), 'done', { actorName: 'Builder' })]);
    const pill = document.querySelector<HTMLElement>('[data-timeline-node^="todo:"]')!;
    expect(pill.style.background).toContain('var(--theme-bg-surface)');
    expect(pill.style.background).toContain('var(--tint-green-bg)');
    expect(pill.style.color).toBe('var(--tint-green-text)');
  });

  it('draws its icons in SVG: no emoji or pictographic glyph', () => {
    setup(MARKS);
    expect(screen.getByTestId('todo-strip').textContent).not.toMatch(GLYPH);
  });
});

describe('TodoMarksPopover', () => {
  const anchor = { left: 400, top: 500, width: 30, height: 18 };
  const chipOf = (marks: TodoMark[]) => layoutTodoStrip(marks, [{ at: Date.parse(at(9, 0)), x: 100 }, { at: NOW, x: 900 }], 2000).chips[0]!;

  it('lists each event: kind, ref, text of the time, actor, time, source, cancel reason', () => {
    const chip = chipOf(MARKS.slice(8));
    render(<TodoMarksPopover chip={chip} anchor={anchor} pinned onClose={vi.fn()} onOpenItem={vi.fn()} onOpenHistory={vi.fn()} />);
    const rows = screen.getAllByTestId('todo-mark-row');
    expect(rows).toHaveLength(4);
    expect(rows[0]!.textContent).toContain('#21');
    expect(rows[0]!.textContent).toContain('Item 21');
    expect(rows[0]!.textContent).toContain('Builder');
    expect(rows[0]!.textContent).toContain('cli');
    expect(rows[3]!.textContent).toContain('« couvert par #3 »');
    expect(screen.getByRole('dialog').textContent).toMatch(/3 faits/);
    expect(screen.getByRole('dialog').textContent).not.toMatch(GLYPH);
  });

  it('opens the item from a row, the whole history from the footer', () => {
    const onOpenItem = vi.fn();
    const onOpenHistory = vi.fn();
    render(<TodoMarksPopover chip={chipOf(MARKS.slice(8))} anchor={anchor} pinned onClose={vi.fn()} onOpenItem={onOpenItem} onOpenHistory={onOpenHistory} />);
    fireEvent.click(screen.getAllByTestId('todo-mark-row')[1]!);
    expect(onOpenItem).toHaveBeenCalledWith('i22');
    fireEvent.click(screen.getByRole('button', { name: "Ouvrir l'historique de la todo" }));
    expect(onOpenHistory).toHaveBeenCalledWith(null);
  });

  it("a lone event's footer opens that item's history", () => {
    const onOpenHistory = vi.fn();
    render(<TodoMarksPopover chip={chipOf([mark(3, at(9, 30), 'reopened')])} anchor={anchor} pinned={false} onClose={vi.fn()} onOpenItem={vi.fn()} onOpenHistory={onOpenHistory} />);
    fireEvent.click(screen.getByRole('button', { name: 'Historique de #3' }));
    expect(onOpenHistory).toHaveBeenCalledWith('i3');
  });

  it('strikes a deleted item and does not offer to open it', () => {
    const onOpenItem = vi.fn();
    render(<TodoMarksPopover chip={chipOf([mark(8, at(9, 5), 'created', { deleted: true })])} anchor={anchor} pinned onClose={vi.fn()} onOpenItem={onOpenItem} onOpenHistory={vi.fn()} />);
    const row = screen.getByTestId('todo-mark-row');
    expect(within(row).getByText('supprimé')).toBeTruthy();
    expect((row as HTMLButtonElement).disabled).toBe(true);
  });

  it('caps the list at 12 rows, then « + N autres »', () => {
    const many = Array.from({ length: 15 }, (_, i) => mark(i + 1, at(9, 5)));
    render(<TodoMarksPopover chip={chipOf(many)} anchor={anchor} pinned onClose={vi.fn()} onOpenItem={vi.fn()} onOpenHistory={vi.fn()} />);
    expect(screen.getAllByTestId('todo-mark-row')).toHaveLength(12);
    expect(screen.getByText('+ 3 autres')).toBeTruthy();
  });

  it('Échap closes it', () => {
    const onClose = vi.fn();
    render(<TodoMarksPopover chip={chipOf(MARKS.slice(8))} anchor={anchor} pinned onClose={onClose} onOpenItem={vi.fn()} onOpenHistory={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
