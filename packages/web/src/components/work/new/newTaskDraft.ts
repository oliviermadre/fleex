import { createContext, createElement, useContext, type ReactNode } from 'react';
import { useWorkStore, type WorkDraft } from '../../../stores/workStore';

/**
 * The draft the new-task screens work on, and where Cancel goes. In the Work view it is the Work store's own draft,
 * and Cancel goes back to the task. Mounted elsewhere (the Factory's desks), the flow is wrapped in
 * `NewTaskDraftProvider` with a draft of its own, so the Work view's draft is left alone.
 */
export interface NewTaskDraftState {
  draft: WorkDraft;
  update: (patch: Partial<WorkDraft>) => void;
  reset: (boardId?: string | null) => void;
  cancel: () => void;
}

const Ctx = createContext<NewTaskDraftState | null>(null);

export function NewTaskDraftProvider({ value, children }: { value: NewTaskDraftState; children: ReactNode }) {
  return createElement(Ctx.Provider, { value }, children);
}

export function useNewTaskDraft(): NewTaskDraftState {
  const own = useContext(Ctx);
  const draft = useWorkStore((s) => s.draft);
  const update = useWorkStore((s) => s.updateDraft);
  const reset = useWorkStore((s) => s.resetDraft);
  const setView = useWorkStore((s) => s.setView);
  return own ?? { draft, update, reset, cancel: () => setView('task') };
}
