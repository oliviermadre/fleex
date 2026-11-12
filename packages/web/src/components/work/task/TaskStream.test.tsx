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

/** Open the "⋯" menu of the n-th comment, and return its items. */
function openActions(n: number) {
  fireEvent.click(screen.getAllByRole('button', { name: 'Actions du commentaire' })[n]!);
  return screen.getAllByRole('menuitem');
}

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

// Lot 6: the assistant asks in its own name (mandate, grouped questions). No
// mention waits behind such a question, and other threads may be running.
describe('TaskStream — the assistant\'s own question', () => {
  const mandate = [{ prompt: 'Mandat « Export CSV » : je lance ?', options: ['Go', 'Ajuster'] }];
  const asked = (over: Partial<TicketComment> = {}) => agentComment({ id: 'q', authorType: 'assistant', authorName: 'Nas', body: 'Le mandat est prêt.', questions: mandate, ...over });

  it.each(['idle', 'running', 'waiting'] as const)('shows Go / Ajuster as buttons whatever the task activity (%s), and answers with the option text', (activity) => {
    const onAnswer = vi.fn();
    render(
      <TaskStream ticketId="t1" description={null} comments={[asked()]} events={[]} executions={[]} deliverables={[]}
        activity={activity} loading={false} error={null} onAnswer={onAnswer} onOpenExecution={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Ajuster' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onAnswer).toHaveBeenCalledWith('Go');
  });

  it('several questions are answered together, in one message', () => {
    const onAnswer = vi.fn();
    const questions = [{ prompt: 'Format ?', options: ['CSV', 'XLSX'] }, { prompt: 'En-têtes ?', options: ['Oui', 'Non'] }];
    render(
      <TaskStream ticketId="t1" description={null} comments={[asked({ questions })]} events={[]} executions={[]} deliverables={[]}
        activity="running" loading={false} error={null} onAnswer={onAnswer} onOpenExecution={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'XLSX' }));
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Non' }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer les 2 réponses' }));
    expect(onAnswer).toHaveBeenCalledWith('**Format ?** XLSX\n**En-têtes ?** Non');
  });

  it('a turn inside a thread does not close it; anything said after it in the main stream does', () => {
    const later = '2026-10-02T17:00:00.000Z';
    const { unmount } = renderStream([asked(), agentComment({ id: 't', authorType: 'assistant', authorName: 'Nas', body: '@agent:builder go', threadId: 'th1', createdAt: later })], 'running');
    expect(screen.getByRole('button', { name: 'Go' })).toBeTruthy();
    unmount();
    renderStream([asked(), agentComment({ id: 'u', authorType: 'user', authorName: 'Olivier', body: 'Go', createdAt: later })], 'idle');
    expect(screen.queryByRole('button', { name: 'Go' })).toBeNull();
  });

  it('the Focus popup owns the answer: no buttons here when action cards are off', () => {
    render(
      <TaskStream ticketId="t1" description={null} comments={[asked()]} events={[]} executions={[]} deliverables={[]}
        activity="idle" loading={false} error={null} onAnswer={vi.fn()} onOpenExecution={vi.fn()} showActionCards={false} />,
    );
    expect(screen.queryByRole('button', { name: 'Go' })).toBeNull();
  });
});

describe('TaskStream — the assistant\'s mode request', () => {
  const request = agentComment({
    id: 'mr', authorType: 'assistant', authorName: 'Nas',
    body: 'Builder doit écrire.\n\n<!-- fleex:mode-request {"mode":"edit","threadId":"th1"} -->',
  });
  const stream = (props: Partial<Parameters<typeof TaskStream>[0]>) =>
    render(
      <TaskStream
        ticketId="t1" description={null} comments={[request]} events={[]} executions={[]} deliverables={[]}
        activity="idle" loading={false} error={null} onAnswer={vi.fn()} onOpenExecution={vi.fn()} {...props}
      />,
    );

  // Focus popup: the other cards are off (its action zone owns them), the mode request keeps its buttons.
  it('stays answerable with the action cards off when the host says so', () => {
    const onGrantMode = vi.fn();
    const onDeclineMode = vi.fn();
    stream({ showActionCards: false, modeRequestActionable: true, onGrantMode, onDeclineMode });
    fireEvent.click(screen.getByRole('button', { name: 'Switch agents to edit and continue' }));
    expect(onGrantMode).toHaveBeenCalledWith({ mode: 'edit', threadId: 'th1' });
    expect(onDeclineMode).not.toHaveBeenCalled();
  });

  it('follows showActionCards otherwise: no buttons in a host that turned the cards off', () => {
    stream({ showActionCards: false });
    expect(screen.getByText('Builder doit écrire.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Switch agents to edit/ })).toBeNull();
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

  // Ticket feedback: one "⋯" menu per comment, always after the comment (on its right), user or agent alike.
  it('offers one "⋯" menu per comment, user and agent alike, holding « Supprimer »', () => {
    renderEditable();
    const menus = screen.getAllByRole('button', { name: 'Actions du commentaire' });
    expect(menus).toHaveLength(2);
    for (const m of menus) {
      const row = m.closest('[data-comment-id]')!;
      // Last focusable control of the row = rightmost: the menu never sits before (left of) the bubble.
      const buttons = [...row.querySelectorAll('button')];
      expect(buttons[buttons.length - 1]).toBe(m);
    }
    expect(openActions(1).map((i) => i.textContent)).toContain('Supprimer');
    expect(screen.queryByRole('button', { name: 'Delete comment' })).toBeNull(); // no stray icon left
  });

  it('shows no menu in a read-only stream (Focus popup)', () => {
    renderEditable(vi.fn(), false);
    expect(screen.queryByRole('button', { name: 'Actions du commentaire' })).toBeNull();
  });

  it('deletes only after confirmation, then drops the comment', async () => {
    deleteTicketComment.mockResolvedValue(undefined);
    const onDeleted = renderEditable();
    fireEvent.click(openActions(1).find((i) => i.textContent === 'Supprimer')!);
    expect(screen.queryByRole('menu')).toBeNull(); // the menu closes on select
    expect(screen.getByText('Delete comment?')).toBeTruthy();
    expect(deleteTicketComment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('c2'));
    expect(deleteTicketComment).toHaveBeenCalledWith('t1', 'c2');
  });

  it('cancelling the confirmation deletes nothing', () => {
    const onDeleted = renderEditable();
    fireEvent.click(openActions(0).find((i) => i.textContent === 'Supprimer')!);
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
    fireEvent.click(openActions(1).find((i) => i.textContent === 'Épingler sur la timeline')!);
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
    // The pinned comment's menu offers to go to its annotation, not to pin it again.
    expect(openActions(1).map((i) => i.textContent)).toEqual(["Voir l'annotation", 'Supprimer']);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
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
    expect(screen.queryByRole('button', { name: 'Actions du commentaire' })).toBeNull();
  });
});
