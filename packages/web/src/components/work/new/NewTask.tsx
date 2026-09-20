import { useCallback, useState } from 'react';
import type { ImportPreview, SourceMatch } from '@fleex/shared';
import { useWorkStore, type DraftSource, type WorkDraft } from '../../../stores/workStore';
import { useRepositoryStore } from '../../../stores/repositoryStore';
import { NewTaskEntry } from './NewTaskEntry';
import { NewTaskResolving } from './NewTaskResolving';
import { NewTaskCompose } from './NewTaskCompose';

/**
 * New task (⌥N / + New Task). The flow has three screens driven by `draft.stage`
 * plus a local `resolving` step (never persisted — a request in flight doesn't
 * survive a reload):
 *
 *   ENTRY → (a recognized link) → RESOLVING → COMPOSE → Start
 *         → (plain text)        →              COMPOSE → Start
 *
 * The import never creates the ticket — it prefills the draft, and `Start`
 * (in COMPOSE) creates it by the normal path.
 */
export function NewTask() {
  const draft = useWorkStore((s) => s.draft);
  const updateDraft = useWorkStore((s) => s.updateDraft);
  const resetDraft = useWorkStore((s) => s.resetDraft);
  const selectTicket = useWorkStore((s) => s.selectTicket);
  const setView = useWorkStore((s) => s.setView);
  const repositories = useRepositoryStore((s) => s.repositories);

  const [resolving, setResolving] = useState<SourceMatch | null>(null);

  const openTicket = useCallback(
    (ticketId: string) => {
      setResolving(null);
      selectTicket(ticketId);
      setView('task');
    },
    [selectTicket, setView],
  );

  const applyPreview = useCallback(
    (preview: ImportPreview) => {
      const patch: Partial<WorkDraft> = {
        title: preview.title,
        text: preview.description,
        stage: 'compose',
      };
      if (preview.suggested?.type) patch.type = preview.suggested.type;

      let pr: DraftSource['pr'];
      let repoWarning: string | undefined;
      if (preview.repo) {
        const { org, name, headRefName, isCrossRepository } = preview.repo;
        const wanted = `${org}/${name}`.toLowerCase();
        const found = repositories.find((r) => `${r.org}/${r.name}`.toLowerCase() === wanted);
        if (found) {
          const key = `${found.org}/${found.name}`;
          patch.repoKeys = [key];
          patch.repoBaseBranches = {};
          patch.repoCheckoutRefs = {};
          if (headRefName) {
            // Default is "branch on top" (protects the PR); a fork can only be
            // checked out directly.
            if (isCrossRepository) patch.repoCheckoutRefs = { [key]: headRefName };
            else patch.repoBaseBranches = { [key]: headRefName };
            pr = { repoKey: key, headRefName, isCrossRepository: !!isCrossRepository };
          }
        } else {
          patch.repoKeys = [];
          repoWarning = `${org}/${name} isn't set up in Fleex — repo not attached.`;
        }
      }

      patch.source = {
        sourceId: preview.sourceId,
        ref: preview.ref,
        url: preview.url,
        label: preview.label,
        links: preview.links,
        tags: preview.tags,
        ...(pr ? { pr } : {}),
        ...(repoWarning ? { repoWarning } : {}),
      };

      updateDraft(patch);
      setResolving(null);
    },
    [repositories, updateDraft],
  );

  if (resolving) {
    // Keep the ENTRY mounted (disabled) behind the resolving screen: an instant
    // source renders nothing for its first 400 ms, and without this backdrop the
    // center would flash blank (spec 5.3 — the ENTRY stays visible, input off).
    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        <NewTaskEntry onImport={setResolving} onOpenTicket={openTicket} disabled />
        <NewTaskResolving
          match={resolving}
          onResolved={applyPreview}
          onCancel={() => setResolving(null)}
          onOpenTicket={openTicket}
        />
      </div>
    );
  }

  if (draft.stage === 'compose') {
    return <NewTaskCompose onStartOver={() => resetDraft()} />;
  }

  return <NewTaskEntry onImport={setResolving} onOpenTicket={openTicket} />;
}
