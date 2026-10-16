import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { TicketTimeline } from './TicketTimeline';
import { buildTimeline } from './buildTimeline';
import { NOW, activity, at, emptySources, fixture591 } from './timeline.fixture';
import type { TimelineAnnotation } from '@fleex/shared';
import type { TimelineAnnotationsProps } from './TicketTimeline';
import { BAND, CREATE_STRIP, PILL, PILL_TOP } from './layoutAnnotations';
import { GEOMETRY } from './layoutTimeline';
import { AnnotationComposer, AnnotationStackList, AnnotationViewer } from './AnnotationPopovers';

afterEach(cleanup);

/**
 * Pictographs and dingbats (📌 📎 💬 ✎ ✕ ⚠ ⇥…) render differently on every OS
 * and read as amateurish: the annotation UI draws its icons in SVG only.
 */
const GLYPH = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

const ALL = { status: true, cli: true, pr: true, deliverables: true, comments: true, annotations: true };
const header = { number: 591, title: 'Importer une tâche depuis Slack', boardName: 'Fleex', status: 'doing', type: 'build' };

function setup(filters = ALL) {
  const onAction = vi.fn();
  const onToggleFilter = vi.fn();
  render(
    <TicketTimeline header={header} model={buildTimeline(fixture591(), NOW)} filters={filters} onToggleFilter={onToggleFilter} onAction={onAction} />,
  );
  return { onAction, onToggleFilter };
}

describe('TicketTimeline', () => {
  it('renders the ticket identity, the flat history and the pending fork', () => {
    setup();
    expect(screen.getByText('#591')).toBeTruthy();
    expect(screen.getAllByText('Valider la spec')).toHaveLength(2);
    expect(screen.getByText('refusé : risques non couverts')).toBeTruthy();
    expect(screen.getByText('maintenant')).toBeTruthy();
    // Fork after now: both outcomes of the Merge gate.
    expect(screen.getByText('Demander des changements')).toBeTruthy();
    expect(screen.getByText('Merger')).toBeTruthy();
  });

  it('hangs every picto above or below the spine from it with a dotted connector', () => {
    setup();
    const lanePictos = buildTimeline(fixture591(), NOW).events.filter((e) => e.lane === 'top' || e.lane === 'bottom');
    // Attached or not (user comments, CLI sessions, workflow starts…): one thread each to the life line.
    expect(document.querySelectorAll('[data-testid="timeline-connector"]')).toHaveLength(lanePictos.length);
  });

  it('opens a deliverable in the reader when its picto is clicked', () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Livrable code/ }));
    expect(onAction).toHaveBeenCalledWith({ type: 'deliverable', deliverableId: 'd-code' }, expect.objectContaining({ id: 'deliv:d-code' }));
  });

  it('opens the execution log of a step that ran an agent', () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Étape Implémentation \(tentative 2\)/ }));
    expect(onAction).toHaveBeenCalledWith(
      { type: 'execution', executionId: 'x-impl-2', title: 'Implémentation' },
      expect.anything(),
    );
  });

  it('hides filtered categories but keeps the spine', () => {
    setup({ ...ALL, deliverables: false, comments: false, status: false });
    expect(screen.queryByRole('button', { name: /^Livrable / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Commentaire de/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Statut / })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Étape/ }).length).toBe(11);
  });

  it('moves the filters behind a button: no chip left in the column, toggled from the popover', () => {
    const { onToggleFilter } = setup();
    expect(screen.queryByRole('group', { name: 'Filtres de la timeline' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Commentaires' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Filtres de la timeline/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Commentaires' }));
    expect(onToggleFilter).toHaveBeenCalledWith('comments');
  });

  it('shows the « Temps » block of an open ticket: age and time in the current status', () => {
    setup();
    const block = within(screen.getByRole('region', { name: 'Temps du ticket' }));
    // #591: created 04:41 in Backlog, Doing since 07:05 (3 h 35 before NOW = 10:40).
    expect(block.getByText('Avant 1er Doing').nextElementSibling!.textContent).toBe('2 h 24');
    expect(block.getByText('Âge').nextElementSibling!.textContent).toBe('5 h 59');
    expect(screen.getByTestId('timeline-time-since').textContent).toBe('Doing depuis3 h 35');
    expect(block.getByRole('img').getAttribute('aria-label')).toMatch(/^Répartition sur la durée de vie : Backlog \d+ %, Todo \d+ %, Doing \d+ %$/);
  });

  it('keeps the « Temps » block identical when the status filter hides the zones', () => {
    setup();
    const before = screen.getByRole('region', { name: 'Temps du ticket' }).textContent;
    cleanup();
    setup({ ...ALL, status: false });
    expect(screen.getByRole('region', { name: 'Temps du ticket' }).textContent).toBe(before);
  });

  it('walks the pictos chronologically with the arrow keys', () => {
    setup();
    const created = screen.getByRole('button', { name: /^Ticket créé/ });
    created.focus();
    fireEvent.keyDown(created, { key: 'ArrowRight' });
    // Next in time: the Backlog status pill (same instant, ranked after creation).
    expect((document.activeElement as HTMLElement).dataset.timelineNode).toBe('status:0');
  });

  it('shows each phase\'s duration and human interventions on the frieze, and hides them with the status filter', () => {
    setup();
    const metrics = screen.getAllByTestId('timeline-zone-metrics').map((n) => n.textContent);
    // #591: Todo lasted 2 h 15 with the @PM request + both spec gates; Doing still runs (3 h 35, 1 comment).
    expect(metrics).toContain('2 h 15·3');
    expect(metrics).toContain('3 h 35·1');
    cleanup();
    setup({ ...ALL, status: false });
    expect(screen.queryAllByTestId('timeline-zone-metrics')).toHaveLength(0);
  });

  it('exposes the phase duration and interventions on the status pill for assistive tech', () => {
    setup();
    expect(screen.getByRole('button', { name: /^Statut Todo par @PM, \d\d:\d\d, durée 2 h 15, 3 interventions humaines$/ })).toBeTruthy();
  });

  it('bounds a closed ticket to its life: lead time, "Done depuis", no Done row, hatched out-of-life zone', () => {
    const src = emptySources();
    src.ticket = { ...src.ticket, status: 'done' };
    src.activities = [
      activity({ id: 'm1', action: 'moved', createdAt: at(9, 30), changes: { status: { from: 'todo', to: 'doing' } } }),
      activity({ id: 'm2', action: 'moved', createdAt: at(10, 0), changes: { status: { from: 'doing', to: 'done' } } }),
    ];
    render(<TicketTimeline header={{ ...header, status: 'done' }} model={buildTimeline(src, NOW)} filters={ALL} onToggleFilter={vi.fn()} onAction={vi.fn()} />);
    const block = within(screen.getByRole('region', { name: 'Temps du ticket' }));
    expect(block.getByText('Lead time client').nextElementSibling!.textContent).toBe('1 h');
    expect(block.queryByText('Âge')).toBeNull();
    expect(screen.getByTestId('timeline-time-since').textContent).toBe('Done depuis40 min');
    expect(screen.getAllByTestId('timeline-status-total').map((r) => r.textContent)).toEqual(['Todo30 min', 'Doing30 min']);
    expect(block.getByRole('img').getAttribute('aria-label')).toBe('Répartition sur la durée de vie : Todo 50 %, Doing 50 %');
    expect(screen.getByTestId('timeline-out-of-life')).toBeTruthy();
  });

  it('shows a skeleton while the model loads', () => {
    render(<TicketTimeline header={header} model={null} filters={ALL} onToggleFilter={vi.fn()} onAction={vi.fn()} />);
    const block = within(screen.getByRole('region', { name: 'Temps du ticket' }));
    expect(block.getAllByText('—')).toHaveLength(3);
  });
});

describe('TicketTimeline — annotations', () => {
  const ann = (id: string, iso: string, over: Partial<TimelineAnnotation> = {}): TimelineAnnotation => ({
    id, ticketId: 't-591', at: iso, title: `Titre ${id}`, body: '', tone: 'info', sourceCommentId: null,
    authorType: 'user', authorName: 'nas', createdAt: iso, updatedAt: iso, ...over,
  });

  function setupAnnotated(list: TimelineAnnotation[], filters = ALL, maxBandHeight?: number) {
    const props = {
      list, highlight: null, onCreateAt: vi.fn<TimelineAnnotationsProps['onCreateAt']>(), onOpenCard: vi.fn<TimelineAnnotationsProps['onOpenCard']>(),
    };
    const onContentHeight = vi.fn();
    render(
      <TicketTimeline
        header={header} model={buildTimeline(fixture591(), NOW)} filters={filters}
        onToggleFilter={vi.fn()} onAction={vi.fn()} annotations={props} onContentHeight={onContentHeight}
        maxBandHeight={maxBandHeight}
      />,
    );
    return { ...props, onContentHeight };
  }

  // AC9: readable without hovering — the title, time and author are in the card itself.
  it('renders every annotation as an always-visible card hung from a dotted anchor', () => {
    setupAnnotated([
      ann('a', at(9, 0), { title: 'Pivot : on lâche Redis', body: '![shot](/api/files/x)' }),
      ann('b', at(10, 0), { authorType: 'agent', authorName: 'builder' }),
    ]);
    const cards = screen.getAllByTestId('annotation-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('Pivot : on lâche Redis');
    expect(cards[0]!.textContent).toContain('nas');
    expect(cards[0]!.querySelector('img')?.getAttribute('src')).toBe('/api/files/x');
    expect(cards[1]!.textContent).toContain('agent');
    expect(document.querySelectorAll('[data-testid="annotation-anchor"]')).toHaveLength(2);
  });

  // AC12: the band is only as tall as it must be.
  it('reserves a thin strip when empty, a row with cards, nothing when filtered out', () => {
    expect(setupAnnotated([]).onContentHeight).toHaveBeenLastCalledWith(BAND.empty + 196);
    cleanup();
    expect(setupAnnotated([ann('a', at(9, 0))]).onContentHeight).toHaveBeenLastCalledWith(BAND.oneRow + 196);
    cleanup();
    setupAnnotated([ann('a', at(9, 0))], { ...ALL, annotations: false });
    expect(screen.queryByTestId('annotation-card')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Filtres de la timeline/ }));
    expect((screen.getByRole('checkbox', { name: 'Annotations' }) as HTMLInputElement).checked).toBe(false);
  });

  // AC1, narrowed by ticket feedback: hovering the band shows the "+" bubble and its instant,
  // but only a click ON the bubble annotates — clicking beside a card (to blur it) must not.
  it('annotates the hovered instant only when its "+" bubble is clicked', () => {
    const { onCreateAt } = setupAnnotated([]);
    const content = screen.getByTestId('timeline-content');
    fireEvent.mouseMove(content, { clientX: 300, clientY: 4 });
    const ghost = screen.getByTestId('annotation-ghost');
    expect(ghost.querySelector('svg')).not.toBeNull();
    expect(ghost.textContent).toMatch(/\d{2}:\d{2}/);
    fireEvent.click(content, { clientX: 300, clientY: 4 });
    expect(onCreateAt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('annotation-ghost-add'));
    expect(onCreateAt).toHaveBeenCalledTimes(1);
    const [instant] = onCreateAt.mock.calls[0]!;
    expect(instant).toBeGreaterThan(Date.parse(at(8, 0)) - 86_400_000);
    expect(instant).toBeLessThanOrEqual(NOW);
  });

  it('ignores a plain click on the frieze below the band (⌥ is needed there)', () => {
    const { onCreateAt } = setupAnnotated([]);
    const content = screen.getByTestId('timeline-content');
    fireEvent.click(content, { clientX: 300, clientY: 100 });
    expect(onCreateAt).not.toHaveBeenCalled();
    fireEvent.click(content, { clientX: 300, clientY: 100, altKey: true });
    expect(onCreateAt).toHaveBeenCalledTimes(1);
  });

  // AC6: A on a focused picto annotates its exact instant.
  it('annotates the exact instant of a focused picto with the A key', () => {
    const { onCreateAt } = setupAnnotated([]);
    const created = screen.getByRole('button', { name: /^Ticket créé/ });
    created.focus();
    fireEvent.keyDown(created, { key: 'a' });
    const ev = buildTimeline(fixture591(), NOW).events.find((e) => e.id === created.dataset.timelineNode)!;
    expect(onCreateAt).toHaveBeenCalledWith(ev.at, expect.anything());
  });

  // Ticket feedback: a short drawer collapses the cards into pills, still on the lifeline, still clickable.
  it('shows pills only when the drawer leaves no room for a card row', () => {
    const { onOpenCard, onContentHeight } = setupAnnotated([ann('a', at(9, 0), { tone: 'success' })], ALL, BAND.oneRow - 1);
    expect(screen.queryByTestId('annotation-card')).toBeNull();
    const pill = screen.getByTestId('annotation-pill');
    expect((pill.querySelector('[data-tone-icon]') as HTMLElement).dataset.toneIcon).toBe('success');
    expect(onContentHeight).toHaveBeenLastCalledWith(BAND.mini + 196);
    const d = screen.getByTestId('annotation-anchor').querySelector('path')!.getAttribute('d')!;
    expect(Number(d.trim().split(/\s+/).pop())).toBe(BAND.mini + GEOMETRY.spineY);
    fireEvent.click(pill);
    expect(onOpenCard).toHaveBeenCalledWith(expect.objectContaining({ kind: 'card' }), expect.anything());
  });

  // Ticket feedback: in the mini band the "+" bubble (wider than a pill) slid on top of the pill and ate its click.
  // Ticket feedback (twice): the "+" must never sit on a pill/card (the annotation stays clickable),
  // yet one must be able to annotate right on/next to an existing one. The "+" lives in its own
  // strip at the bottom of the band, under the annotations.
  it('pills: hovering one shows no "+", the strip right under it does — at that very spot', () => {
    const { onCreateAt } = setupAnnotated([ann('a', at(9, 0))], ALL, BAND.oneRow - 1);
    const pill = screen.getByTestId('annotation-pill');
    const centre = parseFloat(pill.style.left) + PILL / 2;
    const content = screen.getByTestId('timeline-content');
    fireEvent.mouseMove(content, { clientX: centre, clientY: PILL_TOP + PILL / 2 });
    expect(screen.queryByTestId('annotation-ghost')).toBeNull();
    fireEvent.mouseMove(content, { clientX: centre, clientY: BAND.mini - CREATE_STRIP / 2 });
    const add = screen.getByTestId('annotation-ghost-add');
    expect(parseFloat(add.style.top)).toBeGreaterThanOrEqual(PILL_TOP + PILL); // below the pill, never over it
    fireEvent.click(add);
    expect(onCreateAt).toHaveBeenCalledTimes(1);
  });

  it('cards: hovering one shows no "+", the strip under it does, without covering the card', () => {
    setupAnnotated([ann('a', at(9, 0))]);
    const card = screen.getByTestId('annotation-card');
    const content = screen.getByTestId('timeline-content');
    const x = parseFloat(card.style.left) + 100;
    fireEvent.mouseMove(content, { clientX: x, clientY: parseFloat(card.style.top) + 20 });
    expect(screen.queryByTestId('annotation-ghost')).toBeNull();
    fireEvent.mouseMove(content, { clientX: x, clientY: BAND.oneRow - CREATE_STRIP / 2 });
    const add = screen.getByTestId('annotation-ghost-add');
    expect(parseFloat(add.style.top)).toBeGreaterThanOrEqual(parseFloat(card.style.top) + 56);
  });

  // Ticket feedback: a label pinned on the band says it is the annotations row.
  it('labels the band "Annotations", and drops the label with the band', () => {
    setupAnnotated([ann('a', at(9, 0))]);
    expect(screen.getByTestId('annotation-band-label').textContent).toBe('Annotations');
    cleanup();
    setupAnnotated([]);
    expect(screen.getByTestId('annotation-band-label').textContent).toMatch(/^Annotations.*ajouter/);
    cleanup();
    setupAnnotated([ann('a', at(9, 0))], { ...ALL, annotations: false });
    expect(screen.queryByTestId('annotation-band-label')).toBeNull();
  });

  it('keeps full cards when the drawer has room for a row', () => {
    setupAnnotated([ann('a', at(9, 0))], ALL, BAND.oneRow);
    expect(screen.getByTestId('annotation-card')).toBeTruthy();
    expect(screen.queryByTestId('annotation-pill')).toBeNull();
  });

  // Ticket feedback 1/: the dotted anchor lands on the lifeline, it doesn't run past it.
  it('stops every anchor on the lifeline, at its dot', () => {
    setupAnnotated([ann('a', at(9, 0))]);
    const g = screen.getByTestId('annotation-anchor');
    const d = g.querySelector('path')!.getAttribute('d')!;
    const lastY = Number(d.trim().split(/\s+/).pop());
    const spineY = BAND.oneRow + GEOMETRY.spineY;
    expect(lastY).toBe(spineY);
    expect(Number(g.querySelector('circle')!.getAttribute('cy'))).toBe(spineY);
  });

  // Ticket feedback 2/: a stacked screenshot must be visible from the list, not only once opened.
  it('shows the screenshot thumbnail of each stacked annotation in the list', () => {
    render(
      <AnnotationStackList
        annotations={[ann('a', at(9, 0), { body: 'voir ![shot](/api/files/x)' }), ann('b', at(9, 1))]}
        anchor={{ left: 0, top: 0, width: 10, height: 10 }}
        onClose={vi.fn()} onOpen={vi.fn()}
      />,
    );
    const [withShot, without] = screen.getAllByTestId('annotation-stack-item');
    expect(withShot!.querySelector('img')?.getAttribute('src')).toBe('/api/files/x');
    expect(without!.querySelector('img')).toBeNull();
  });

  // Ticket feedback: one icon per tone, in the tone's colour, the same on the card, the stack and the chips.
  it("shows each card's tone icon, in the tone's colour", () => {
    setupAnnotated([ann('a', at(9, 0), { tone: 'success' }), ann('b', at(14, 0), { tone: 'warning' })]);
    const [ok, warn] = screen.getAllByTestId('annotation-card');
    const okIcon = ok!.querySelector('[data-tone-icon]') as HTMLElement;
    expect(okIcon.dataset.toneIcon).toBe('success');
    expect(okIcon.style.color).toBe('var(--tint-green-solid)');
    expect((warn!.querySelector('[data-tone-icon]') as HTMLElement).dataset.toneIcon).toBe('warning');
  });

  it('lists the tone of every stacked annotation by its icon', () => {
    setupAnnotated(['info', 'highlight', 'warning', 'success'].map((tone, i) => ann(`s${i}`, at(9, i), { tone: tone as TimelineAnnotation['tone'] })));
    const stack = screen.getByRole('button', { name: '4 annotations' });
    expect([...stack.querySelectorAll<HTMLElement>('[data-tone-icon]')].map((el) => el.dataset.toneIcon)).toEqual(['info', 'highlight', 'warning', 'success']);
  });

  it('picks the tone on chips carrying the same icons', () => {
    render(
      <AnnotationComposer
        request={{ mode: 'create', ticketId: 't-591', draft: { at: at(9, 0), title: '', body: '', tone: 'info' } }}
        anchor={{ left: 0, top: 0, width: 10, height: 10 }}
        ticketCreatedAt={null} onSubmit={vi.fn()} onCancel={vi.fn()}
      />,
    );
    const chips = within(screen.getByRole('radiogroup', { name: 'Ton' })).getAllByRole('radio');
    expect(chips.map((c) => (c.querySelector('[data-tone-icon]') as HTMLElement).dataset.toneIcon)).toEqual(['info', 'highlight', 'warning', 'success']);
    expect(chips.map((c) => c.textContent)).toEqual(['info', 'mise en avant', 'attention', 'succès']);
  });

  it('draws the card markers as SVG icons, never as emoji', () => {
    setupAnnotated([ann('a', at(9, 0), { body: 'Un détail en plus', sourceCommentId: 'c1' })]);
    const card = screen.getByTestId('annotation-card');
    expect(card.querySelectorAll('svg')).toHaveLength(3); // tone + detail + pinned from a comment
    expect(card.textContent).not.toMatch(GLYPH);
  });

  it('draws the reader icons (close, comment link, edit, delete) as SVG, never as emoji', () => {
    render(
      <AnnotationViewer
        annotation={ann('a', at(9, 0), { body: 'Détail', sourceCommentId: 'c1' })}
        anchor={{ left: 0, top: 0, width: 10, height: 10 }}
        onClose={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onTone={vi.fn()} onSeeComment={vi.fn()}
      />,
    );
    const viewer = screen.getByTestId('annotation-viewer');
    expect(viewer.textContent).not.toMatch(GLYPH);
    for (const name of ['Fermer', /Voir le commentaire/, /Modifier/, /Supprimer/]) {
      expect(within(viewer).getByRole('button', { name }).querySelector('svg')).not.toBeNull();
    }
  });

  // AC14: click (or Enter — it is a button) opens it.
  it('reports a card click to the host', () => {
    const { onOpenCard } = setupAnnotated([ann('a', at(9, 0))]);
    fireEvent.click(screen.getByTestId('annotation-card'));
    expect(onOpenCard).toHaveBeenCalledWith(expect.objectContaining({ kind: 'card' }), expect.anything());
  });
});

// Ticket feedback: under a spine node, keep the bold label and only the time —
// who ran it / what triggered it is in the node's tooltip.
describe('TicketTimeline — spine labels', () => {
  it('shows the label and the time only, never the sub-label', () => {
    setup();
    const step = buildTimeline(fixture591(), NOW).events.find((e) => e.id === 'step:sr-impl-1')!;
    expect(step.sub).toBe('@Dev');
    const content = screen.getByTestId('ticket-timeline');
    expect(content.textContent).not.toContain(`@Dev · ${step.clock}`);
    const label = within(content).getAllByText(step.label).find((el) => el.nextElementSibling?.textContent === step.clock);
    expect(label).toBeDefined();
  });
});

describe('TicketTimeline — control column', () => {
  // Ticket feedback 4/: the type is the app's SVG type icon, not the emoji.
  it('shows the ticket type as an SVG icon, never an emoji', () => {
    setup();
    const column = screen.getByTestId('ticket-timeline').querySelector('aside')!;
    expect(column.textContent).not.toMatch(GLYPH);
    expect(column.querySelector('svg')).not.toBeNull();
  });

  it('steps the zoom through its levels and resets it from the label', () => {
    const onZoom = vi.fn();
    render(
      <TicketTimeline
        header={header} model={buildTimeline(fixture591(), NOW)} filters={ALL}
        onToggleFilter={vi.fn()} onAction={vi.fn()} zoom={2} onZoom={onZoom}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Étaler la frise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resserrer la frise' }));
    fireEvent.click(screen.getByRole('button', { name: /^Zoom ×2/ }));
    expect(onZoom.mock.calls.map((c) => c[0])).toEqual([4, 1, 1]);
  });

  it('disables zooming past the last level', () => {
    render(
      <TicketTimeline
        header={header} model={buildTimeline(fixture591(), NOW)} filters={ALL}
        onToggleFilter={vi.fn()} onAction={vi.fn()} zoom={8} onZoom={vi.fn()}
      />,
    );
    expect((screen.getByRole('button', { name: 'Étaler la frise' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
