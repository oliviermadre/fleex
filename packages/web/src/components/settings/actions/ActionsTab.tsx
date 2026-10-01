import { useEffect } from 'react';
import { useActionsSettingsStore } from '../../../stores/actionsSettingsStore';
import { useUIStore } from '../../../stores/uiStore';
import { ActionDetail } from './ActionDetail';
import { ActionList } from './ActionList';
import { ComposeActionModal } from './ComposeActionModal';

/**
 * Settings › Actions: one tab for both the top-bar (pinned) and the ticket
 * actions, routed as list (`/settings/actions/:scope`) or detail
 * (`/settings/actions/:scope/:id`, `new` for an unsaved draft).
 */
export function ActionsTab() {
  const { scope, id } = useUIStore((s) => s.actionsRoute);
  const aiAvailable = useActionsSettingsStore((s) => s.aiAvailable);
  const loadAiStatus = useActionsSettingsStore((s) => s.loadAiStatus);
  const setComposeOpen = useActionsSettingsStore((s) => s.setComposeOpen);

  useEffect(() => {
    void loadAiStatus();
  }, [loadAiStatus]);

  // ⌘K opens "Describe an action" — captured here so the global command
  // palette does not also open while this tab is showing.
  useEffect(() => {
    if (!aiAvailable) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setComposeOpen(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [aiAvailable, setComposeOpen]);

  return (
    <>
      {id ? <ActionDetail key={`${scope}/${id}`} scope={scope} id={id} /> : <ActionList scope={scope} />}
      {aiAvailable && <ComposeActionModal scope={scope} />}
      {aiAvailable === false && (
        <p className="mt-6 text-[11px] text-[var(--theme-text-faint)]">
          AI helpers unavailable: connect Claude on this instance (Settings › Connectors) to get command, probe and icon suggestions.
        </p>
      )}
    </>
  );
}
