/**
 * The center column when a task is selected: header, conversation stream,
 * suggestion chips and composer. Reads the ticket's description from ticketStore
 * for the opening message and drives comments through useTaskConversation. The
 * composer text is owned here so suggestion chips can seed an @mention into it.
 */
import { useEffect, useState } from 'react';
import { useTicketStore } from '../../../stores/ticketStore';
import type { WorkTask } from '../types';
import { TaskHeader } from './TaskHeader';
import { TaskStream } from './TaskStream';
import { Composer } from './Composer';
import { Suggestions } from './Suggestions';
import { useTaskConversation } from './useTaskConversation';

export function TaskPane({ task }: { task: WorkTask | null }) {
  const description = useTicketStore((s) =>
    task ? s.tickets.find((t) => t.id === task.id)?.description ?? null : null,
  );
  const convo = useTaskConversation(task?.id ?? null);
  const [composer, setComposer] = useState('');

  // Clear the draft when switching tasks so a seeded mention doesn't leak across.
  useEffect(() => {
    setComposer('');
  }, [task?.id]);

  if (!task) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--theme-text-faint)]">
        Select a task, or start a new one.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TaskHeader task={task} />
      <TaskStream
        description={description}
        comments={convo.comments}
        activity={task.activity}
        loading={convo.loading}
        error={convo.error}
        onAnswer={convo.post}
      />
      <Suggestions task={task} onSeedComposer={(text) => setComposer((prev) => (prev ? `${prev} ${text}` : text))} />
      <Composer value={composer} onChange={setComposer} posting={convo.posting} onSend={convo.post} />
    </div>
  );
}
