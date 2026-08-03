import { useCapabilities } from '../../hooks/useCapabilities';
import {
  WORKFLOWS_UNAVAILABLE_TITLE,
  workflowsUnavailableDetail,
} from '../../lib/capabilityMessages';
import { PrimitiveIcon } from '../../lib/primitives';

/**
 * Full-surface explanation shown wherever a workflow view would have rendered
 * while the server's storage driver has no workflow support. Mirrors the
 * EmptyState / AgentEmptyState layout so a dead end always looks the same.
 *
 * `compact` drops the centring shell for surfaces already embedded in a panel
 * (the ticket Workflow tab).
 */
export function WorkflowsUnavailableState({ compact = false }: { compact?: boolean }) {
  const { storageDriver } = useCapabilities();

  return (
    <div
      className={
        compact
          ? 'flex h-full w-full items-center justify-center p-6'
          : 'flex min-w-0 flex-1 items-center justify-center bg-[var(--theme-bg-primary)]'
      }
    >
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="text-[var(--theme-text-faint)]">
          <PrimitiveIcon kind="workflow" size={48} tinted={false} />
        </span>
        <div>
          <h3 className="text-base font-semibold text-[var(--theme-text-primary)]">
            {WORKFLOWS_UNAVAILABLE_TITLE}
          </h3>
          <p className="mt-2 text-sm text-[var(--theme-text-muted)]">
            {workflowsUnavailableDetail(storageDriver)}
          </p>
        </div>
      </div>
    </div>
  );
}
