/**
 * Named actions: actions that have a name of their own ("test", "lint", "build"), which each repository fills in
 * with its own command. The list is made in Settings, a repository's commands in its Config tab, and a script
 * station of the Factory runs them by name. A new action shows everywhere without touching what already uses the
 * others.
 *
 * Both parts save by themselves, and show only while the Factory is on: nothing else runs these yet.
 */
import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useSettingsStore } from '../stores/settingsStore';
import { useFactoryStore } from './factoryStore';
import { CommitInput } from './FactoryMachinePopup';
import { actionName, type NamedAction } from './script';

const useNamed = (): NamedAction[] => useSettingsStore((s) => s.settings.namedActions) ?? [];

/** Settings › General: the list of named actions. */
export function NamedActionsSettings() {
  const on = useFactoryStore((s) => s.enabled), named = useNamed(), saveSettings = useSettingsStore((s) => s.saveSettings);
  const [draft, setDraft] = useState('');
  if (!on) return null;
  const save = (next: NamedAction[]) => void saveSettings({ namedActions: next });
  const fresh = actionName(draft), taken = named.some((a) => a.name === fresh);
  const add = () => { if (fresh && !taken) { save([...named, { name: fresh }]); setDraft(''); } };
  return (
    <div className="mt-4 border-t border-[var(--theme-border)] pt-4" role="group" aria-label="Named actions">
      <div className="text-sm font-medium text-[var(--theme-text-primary)]">Named actions</div>
      <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
        Actions every repository can define its own command for: "test", "lint", "build". Each repository says what they run in its Config tab, and a script
        station of the Factory runs them by name.
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {named.length === 0 && <p className="text-xs text-[var(--theme-text-muted)]">None yet.</p>}
        {named.map((a) => (
          <div key={a.name} className="flex items-center gap-2">
            <span className="w-32 flex-none truncate font-mono text-xs text-[var(--theme-text-primary)]">{a.name}</span>
            <div className="min-w-0 flex-1">
              <CommitInput id={`named-${a.name}`} label="" placeholder="What it is for" value={a.description ?? ''} onCommit={(v) => save(named.map((x) => (x.name === a.name ? { ...x, description: v.trim() || undefined } : x)))} />
            </div>
            <Button size="sm" variant="ghost" aria-label={`Remove the action ${a.name}`} title="Repositories keep their command for it; stations that run it find nothing to run" onClick={() => save(named.filter((x) => x.name !== a.name))}>×</Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <div className="w-48"><Input id="named-new" aria-label="Name of a new action" placeholder="a name, such as test" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} /></div>
          <Button size="sm" onClick={add} disabled={!fresh || taken}>Add an action</Button>
          {taken && <span className="text-xs text-[var(--theme-text-muted)]">There is one by that name already.</span>}
        </div>
      </div>
    </div>
  );
}

/** A repository's Config tab: what each named action runs here. */
export function RepoNamedActions({ org, name }: { org: string; name: string }) {
  const on = useFactoryStore((s) => s.enabled), named = useNamed();
  const config = useSettingsStore((s) => s.settings.repoConfigs[`${org}/${name}`]), setRepoConfig = useSettingsStore((s) => s.setRepoConfig);
  if (!on) return null;
  const actions = config?.actions ?? {};
  const set = (action: string, command: string) => {
    const next = { ...actions };
    if (command.trim()) next[action] = command.trim(); else delete next[action];
    setRepoConfig(org, name, { ...(config ?? {}), actions: next });
  };
  return (
    <div className="mt-6 border-t border-[var(--theme-border)] pt-4" role="group" aria-label="Named actions of this repository">
      <div className="text-sm font-medium text-[var(--theme-text-primary)]">Named actions</div>
      <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
        What each named action runs in a worktree of this repository. A script station of the Factory that runs "test" runs this repository's "test" here; an
        action left empty is one this repository does not have.
      </p>
      {named.length === 0
        ? <p className="mt-2 text-xs text-[var(--theme-text-muted)]">No named action yet: create them in Settings, under General.</p>
        : (
          <div className="mt-2 flex flex-col gap-1.5">
            {named.map((a) => (
              <div key={a.name} className="flex items-center gap-2">
                <span className="w-32 flex-none truncate font-mono text-xs text-[var(--theme-text-primary)]" title={a.description}>{a.name}</span>
                <div className="min-w-0 flex-1"><CommitInput id={`repo-action-${a.name}`} label="" placeholder={a.description || 'a shell command, run in the worktree'} value={actions[a.name] ?? ''} onCommit={(v) => set(a.name, v)} /></div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
