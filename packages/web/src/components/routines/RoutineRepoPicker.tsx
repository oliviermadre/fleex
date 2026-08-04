import { useEffect, useMemo } from 'react';
import { useRepositoryStore } from '../../stores/repositoryStore';

/**
 * Repository selector for a routine subject.
 *
 * Replaces a free-text tag input. That input only committed a repo on
 * Enter/space/comma, so typing `org/name` and clicking "Create routine"
 * silently saved `repos: []` — the run then got a workspace with no worktree
 * and the agent found an empty CWD. Picking from the tracked repositories makes
 * both the typo and the uncommitted-text case impossible, and guarantees the
 * `org/name` ref the worktree builder expects.
 */
export function RoutineRepoPicker({ value, onChange }: {
  value: string[];
  onChange: (repos: string[]) => void;
}) {
  const repositories = useRepositoryStore((s) => s.repositories);
  const fetchRepositories = useRepositoryStore((s) => s.fetchRepositories);

  // Repos added since app boot (Repositories panel, CLI, another window) would
  // otherwise be missing from the list.
  useEffect(() => { void fetchRepositories(); }, [fetchRepositories]);

  const options = useMemo(
    () => repositories
      .map((r) => `${r.org}/${r.name}`)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    [repositories],
  );

  const available = useMemo(
    () => options.filter((key) => !value.includes(key)),
    [options, value],
  );

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-[var(--theme-text-secondary)]">
        Repositories
      </label>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((repo) => (
            <span
              key={repo}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]"
            >
              {repo}
              <button
                type="button"
                aria-label={`Remove ${repo}`}
                className="text-current leading-none hover:text-[var(--theme-text-primary)]"
                onClick={() => onChange(value.filter((r) => r !== repo))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {available.length > 0 ? (
        <select
          aria-label="Add repository"
          className="w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-sm text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...value, e.target.value]);
          }}
        >
          <option value="" disabled>+ Add repository…</option>
          {available.map((key) => (
            <option key={key} value={key}>{key}</option>
          ))}
        </select>
      ) : options.length === 0 ? (
        <span className="text-xs text-[var(--theme-text-muted)]">
          No repositories tracked — add one from the Repositories panel.
        </span>
      ) : null}

      <div className="text-xs text-[var(--theme-text-muted)]">
        A worktree is created for each repository. Leave empty to run without a workspace.
      </div>
    </div>
  );
}
