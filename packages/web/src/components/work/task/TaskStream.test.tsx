import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { TicketComment } from '@fleex/shared';

vi.mock('../../tickets/TicketActionCards', () => ({ TicketActionCards: () => null }));
const deleteTicketComment = vi.fn();
const fetchTicketAnnotations = vi.fn();
vi.mock('../../../services/api', () => ({
  deleteTicketComment: (t: string, c: string) => deleteTicketComment(t, c),
  fetchTicketAnnotations: (t: string) => fetchTicketAnnotations(t),
}));
vi.mock('../../markdown/useAllMentionOptions', () => ({ useAllMentionOptions: () => [] }));

import { TaskStream } from './TaskStream';
import { useAnnotationStore } from '../../../stores/annotationStore';
import { useWorkStore } from '../../../stores/workStore';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  fetchTicketAnnotations.mockReset().mockResolvedValue([]);
  useAnnotationStore.setState({ byTicket: {}, composer: null, highlight: null });
});
afterEach(cleanup);

// Real body of the #604 comment that produced four bogus buttons.
const BODY_604 = "**Le front (lot 5) n'est pas fait** : `odys-front` n'est pas dans ce workspace. Il me faut deux réponses :\n1. Tu attaches `odys-front` à ce ticket pour que je fasse l'écran admin (4 à 5 j), ou on ouvre un ticket séparé ?\n2. Tu valides les 6 écarts au PRD listés dans la PR ? Le principal : la config par défaut est dans le code (version 0) au lieu d'un seed en v1.\n\nAutre point à savoir : le panier « À archiver » prend jusqu'à 141 dossiers sur 206.";

function agentComment(over: Partial<TicketComment> = {}): TicketComment {
  return {
    id: 'c1', ticketId: 't1', authorType: 'agent', authorName: 'The Builder', body: BODY_604,
    visibility: 'public', privateRecipients: [], mentions: [], parentId: null,
    createdAt: '2026-10-02T16:49:58.478Z', updatedAt: '2026-10-02T16:49:58.478Z', ...over,
  };
}

const renderStream = (comments: TicketComment[], activity: 'waiting' | 'running' | 'idle') =>
  render(
    <TaskStream
      ticketId="t1" description={null} comments={comments} events={[]} executions={[]} deliverables={[]}
      activity={activity} loading={false} error={null} onAnswer={vi.fn()} onOpenExecution={vi.fn()}
    />,
  );

describe('TaskStream — inline question card', () => {
  it('renders no choice card for a waiting comment without declared questions (#604)', () => {
    renderStream([agentComment()], 'waiting');
    expect(screen.queryByText('WAITING FOR YOUR CHOICE')).toBeNull();
  });

  it('renders the card when the waiting comment declares questions', () => {
    renderStream([agentComment({ questions: [{ prompt: 'Front ?', options: ['Ici', 'Séparé'] }] })], 'waiting');
    expect(screen.getByText('WAITING FOR YOUR CHOICE')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Séparé' })).toBeTruthy();
  });

  it('renders no card once the task is no longer waiting, even with questions', () => {
    renderStream([agentComment({ questions: [{ prompt: 'Front ?', options: ['Ici', 'Séparé'] }] })], 'running');
    expect(screen.queryByText('WAITING FOR YOUR CHOICE')).toBeNull();
  });
});

describe('TaskStream — deleting a comment', () => {
  beforeEach(() => {
    deleteTicketComment.mockReset();
  });
  const userComment = agentComment({ id: 'c2', authorType: 'user', authorName: 'Me', body: 'Please ship it' });

  const renderEditable = (onCommentDeleted = vi.fn(), editable = true) => {
    render(
      <TaskStream
        ticketId="t1" description={null} comments={[agentComment(), userComment]} events={[]} executions={[]}
        deliverables={[]} activity="idle" loading={false} error={null} onAnswer={vi.fn()} onOpenExecution={vi.fn()}
        editable={editable} onCommentDeleted={onCommentDeleted}
      />,
    );
    return onCommentDeleted;
  };

  it('offers a trash on every comment, user and agent alike', () => {
    renderEditable();
    expect(screen.getAllByRole('button', { name: 'Delete comment' })).toHaveLength(2);
  });

  it('shows no trash in a read-only stream (Focus popup)', () => {
    renderEditable(vi.fn(), false);
    expect(screen.queryByRole('button', { name: 'Delete comment' })).toBeNull();
  });

  it('deletes only after confirmation, then drops the comment', async () => {
    deleteTicketComment.mockResolvedValue(undefined);
    const onDeleted = renderEditable();
    const [, userTrash] = screen.getAllByRole('button', { name: 'Delete comment' });
    fireEvent.click(userTrash!);
    expect(screen.getByText('Delete comment?')).toBeTruthy();
    expect(deleteTicketComment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('c2'));
    expect(deleteTicketComment).toHaveBeenCalledWith('t1', 'c2');
  });

  it('cancelling the confirmation deletes nothing', () => {
    const onDeleted = renderEditable();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete comment' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteTicketComment).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe('TaskStream — pinning a comment to the Timeline', () => {
  const userComment = agentComment({ id: 'c2', authorType: 'user', authorName: 'Me', body: '**Pivot** : on lâche Redis\n\ndétails' });
  const renderEditable = () =>
    render(
      <TaskStream
        ticketId="t1" description={null} comments={[agentComment(), userComment]} events={[]} executions={[]}
        deliverables={[]} activity="idle" loading={false} error={null} onAnswer={vi.fn()} onOpenExecution={vi.fn()}
        editable
      />,
    );

  // AC7: the pin opens the Timeline with the composer pre-filled from the comment.
  it('opens the Timeline composer pre-filled with the first line, the whole body and the posting instant', () => {
    useWorkStore.getState().setTimelineOpen(false);
    renderEditable();
    fireEvent.click(screen.getAllByRole('button', { name: 'Épingler sur la timeline' })[1]!);
    expect(useWorkStore.getState().timelineOpen).toBe(true);
    expect(useAnnotationStore.getState().composer).toEqual({
      mode: 'promote', ticketId: 't1', commentId: 'c2',
      draft: { at: userComment.createdAt, title: 'Pivot : on lâche Redis', body: userComment.body, tone: 'highlight' },
    });
  });

  // AC8: a pinned comment cannot be pinned again — it shows the badge, which leads to the annotation.
  it('shows "Épinglé" instead of the pin once the comment has an annotation, and pulses it on click', async () => {
    fetchTicketAnnotations.mockResolvedValue([{
      id: 'a1', ticketId: 't1', at: userComment.createdAt, title: 'Pivot', body: '', tone: 'info', sourceCommentId: 'c2',
      authorType: 'user', authorName: 'Me', createdAt: userComment.createdAt, updatedAt: userComment.createdAt,
    }]);
    renderEditable();
    const badge = await screen.findByRole('button', { name: "Voir l'annotation" });
    expect(screen.getAllByRole('button', { name: 'Épingler sur la timeline' })).toHaveLength(1);
    // SVG pushpin, not the 📌 emoji (renders differently on every OS).
    expect(badge.textContent).toBe('Épinglé');
    expect(badge.querySelector('svg')).not.toBeNull();
    fireEvent.click(badge);
    expect(useAnnotationStore.getState().highlight?.id).toBe('a1');
  });

  it('offers no pin in a read-only stream', () => {
    render(
      <TaskStream
        ticketId="t1" description={null} comments={[userComment]} events={[]} executions={[]}
        deliverables={[]} activity="idle" loading={false} error={null} onAnswer={vi.fn()} onOpenExecution={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Épingler sur la timeline' })).toBeNull();
  });
});
