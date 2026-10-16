import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { TicketTimeline } from './TicketTimeline';
import { buildTimeline } from './buildTimeline';
import { NOW, activity, at, emptySources, fixture591 } from './timeline.fixture';

afterEach(cleanup);

const ALL = { status: true, cli: true, pr: true, deliverables: true, comments: true };
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
    fireEvent.click(screen.getByRole('button', { name: 'Filtres de la timeline' }));
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
