import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TicketTimeline } from './TicketTimeline';
import { buildTimeline } from './buildTimeline';
import { NOW, fixture591 } from './timeline.fixture';

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

  it('toggles a filter chip', () => {
    const { onToggleFilter } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Commentaires' }));
    expect(onToggleFilter).toHaveBeenCalledWith('comments');
  });

  it('walks the pictos chronologically with the arrow keys', () => {
    setup();
    const created = screen.getByRole('button', { name: /^Ticket créé/ });
    created.focus();
    fireEvent.keyDown(created, { key: 'ArrowRight' });
    // Next in time: the Backlog status pill (same instant, ranked after creation).
    expect((document.activeElement as HTMLElement).dataset.timelineNode).toBe('status:0');
  });
});
