import { useSettingsStore } from '../../stores/settingsStore';
import { buildWorktreeContext } from '../../lib/templateUtils';
import { renderIcon } from './PinnedIcons';

interface Props {
  repositoryOrg: string;
  repositoryName: string;
  branch: string;
  worktreePath: string;
}

export function WorktreeActionsBar({ repositoryOrg, repositoryName, branch, worktreePath }: Props) {
  const worktreeActions = useSettingsStore((s) => s.settings.worktreeActions);
  const executeWorktreeAction = useSettingsStore((s) => s.executeWorktreeAction);

  if (!worktreeActions || worktreeActions.length === 0) return null;

  const context = buildWorktreeContext(repositoryOrg, repositoryName, branch, worktreePath);

  return (
    <div
      className={
        'pointer-events-none absolute left-2 top-full z-30 pt-1 ' +
        'opacity-0 transition-all duration-150 ease-out ' +
        'group-hover/wt:pointer-events-auto group-hover/wt:opacity-100 group-hover/wt:translate-y-0 ' +
        '-translate-y-1'
      }
    >
      <div
        className={
          'flex items-center gap-1 rounded-lg border border-[var(--theme-accent-muted)] px-1.5 py-1 ' +
          'bg-[var(--theme-accent-muted)] backdrop-blur-xl ' +
          'shadow-lg shadow-[var(--theme-accent-muted)]'
        }
      >
        {worktreeActions.map((action) => (
          <button
            key={action.id}
            className={
              'flex h-7 w-7 cursor-pointer items-center justify-center rounded-md ' +
              'bg-[var(--theme-accent-muted)] text-[var(--theme-text-secondary)] ' +
              'transition-all duration-150 ' +
              'hover:bg-[var(--theme-accent)] hover:text-white hover:shadow-[0_0_10px_var(--theme-accent-muted)]'
            }
            onClick={(e) => {
              e.stopPropagation();
              executeWorktreeAction(action, context);
            }}
            title={action.label}
          >
            {action.icon ? (
              renderIcon(action, 14)
            ) : (
              <span className="text-[10px] font-semibold leading-none">
                {action.label.charAt(0).toUpperCase()}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
