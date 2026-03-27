import { useState, useCallback, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';

interface Props {
  org: string;
  name: string;
}

const TEMPLATE_VARS = [
  { name: '{{org}}', desc: 'Repository org' },
  { name: '{{repo}}', desc: 'Repository name' },
  { name: '{{branch}}', desc: 'Branch name' },
  { name: '{{worktree_path}}', desc: 'Worktree absolute path' },
];

const DEFAULT_TIMEOUT = 60;

export function RepoConfigPanel({ org, name }: Props) {
  const getRepoConfig = useSettingsStore((s) => s.getRepoConfig);
  const setRepoConfig = useSettingsStore((s) => s.setRepoConfig);

  const [script, setScript] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(DEFAULT_TIMEOUT);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const config = getRepoConfig(org, name);
    setScript(config.postCheckoutHook ?? '');
    setTimeoutSeconds(config.hookTimeoutSeconds ?? DEFAULT_TIMEOUT);
    setSaved(false);
  }, [org, name, getRepoConfig]);

  const handleSave = useCallback(() => {
    setRepoConfig(org, name, {
      postCheckoutHook: script,
      hookTimeoutSeconds: timeoutSeconds,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [org, name, script, timeoutSeconds, setRepoConfig]);

  const handleClear = useCallback(() => {
    setScript('');
  }, []);

  return (
    <div className="space-y-4">
      {/* Post-checkout hook section */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium text-[var(--theme-text-primary)]">
            Post-checkout hook
          </h3>
          <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
            Shell script automatically run in each new worktree after creation.
            Runs asynchronously — the UI is not blocked.
          </p>
        </div>

        {/* Available variables */}
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARS.map((v) => (
            <span
              key={v.name}
              className="rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--theme-text-muted)]"
              title={v.desc}
            >
              {v.name}
            </span>
          ))}
        </div>

        {/* Script textarea */}
        <textarea
          value={script}
          onChange={(e) => {
            setScript(e.target.value);
            setSaved(false);
          }}
          placeholder={`#!/bin/bash\n\n# Copy .env file\ncp {{worktree_path}}/../.env {{worktree_path}}/.env\n\n# Install dependencies\nbun install`}
          className="h-48 w-full resize-y rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] p-3 font-mono text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)]/40 focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]/30"
          spellCheck={false}
        />

        {/* Timeout setting */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--theme-text-muted)]">
            Timeout after
          </label>
          <input
            type="number"
            min={5}
            max={600}
            value={timeoutSeconds}
            onChange={(e) => {
              setTimeoutSeconds(Math.max(5, Math.min(600, parseInt(e.target.value) || DEFAULT_TIMEOUT)));
              setSaved(false);
            }}
            className="w-20 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-2 py-1 text-center text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
          />
          <span className="text-xs text-[var(--theme-text-muted)]">seconds</span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          {saved && (
            <span className="text-xs text-emerald-400">Saved</span>
          )}
          <button
            onClick={handleClear}
            className="rounded-md px-3 py-1.5 text-xs text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
          >
            Clear
          </button>
          <button
            onClick={handleSave}
            className="rounded-md bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-medium text-[var(--theme-bg-primary)] hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
