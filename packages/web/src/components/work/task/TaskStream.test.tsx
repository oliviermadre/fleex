import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { TicketComment } from '@fleex/shared';

vi.mock('../../tickets/TicketActionCards', () => ({ TicketActionCards: () => null }));
const deleteTicketComment = vi.fn();
vi.mock('../../../services/api', () => ({
  deleteTicketComment: (t: string, c: string) => deleteTicketComment(t, c),
}));
vi.mock('../../markdown/useAllMentionOptions', () => ({ useAllMentionOptions: () => [] }));

import { TaskStream } from './TaskStream';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

// Real body of the #604 comment that produced four bogus buttons.
const BODY_604 = "**Le front (lot 5) n'est pas fait** : `odys-front` n'est pas dans ce workspace. Il me faut deux réponses :\n1. Tu attaches `odys-front` à ce ticket pour que je fasse l'écran admin (4 à 5 j), ou on ouvre un ticket séparé ?\n2. Tu valides les 6 écarts au PRD listés dans la PR ? Le principal : la config par défaut est dans le code (version 0) au lieu d'un seed en v1.\n\nAutre point à savoir : le panier « À archiver » prend jusqu'à 141 dossiers sur 206.";

function agentComment(over: Partial<TicketComment> = {}): TicketComment {
  return {
    id: 'c1', ticketId: 't1', authorType: 'agent', authorName: 'The Builder', body: BODY_604,
    visibility: 'public', privateRecipients: [], mentions: [], parentId: null, threadId: null,
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
