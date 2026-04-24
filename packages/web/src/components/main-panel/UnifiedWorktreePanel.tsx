import { useMemo, useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useWorktreeContext, type WorktreeEntry } from '../../hooks/useWorktreeContext';
import { WorktreeHeader } from './tab-engine/WorktreeHeader';
import { TabBar } from './tab-engine/TabBar';
import { useTabEngine } from './tab-engine/useTabEngine';
import { getTabKind } from './tab-engine/registry';
import type { TabDescriptor } from './tab-engine/types';
import { SmartSessionButton } from '../dashboard/SmartSessionButton';
import * as api from '../../services/api';

// Side-effect: register all tab kinds
import './tab-engine/kinds';
import { buildShellTab, buildClaudeTab, buildAgentTab, buildTicketTab } from './tab-engine/kinds';

interface Props {
  entry: WorktreeEntry;
  focused?: boolean;
  isSplit?: boolean;
  onFocus?: () => void;
}

export function UnifiedWorktreePanel({ entry, focused, isSplit, onFocus }: Props) {
  const ctx = useWorktreeContext(entry);
  const { worktree, repoOrg, repoName, groupId, sessions, executions, ticket } = ctx;

  const addSessionToGroup = useSessionStore((s) => s.addSessionToGroup);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const basePath = useSettingsStore((s) => s.settings.basePath);
  const personas = useAgentPersonaStore((s) => s.personas);

  // Build tab descriptors from sessions + executions (grouped by agent)
  const allTabs = useMemo<TabDescriptor[]>(() => {
    const sessionTabs = sessions.map((s) =>
      s.type === 'shell' ? buildShellTab(s) : buildClaudeTab(s),
    );

    // Group executions by personaId → 1 tab per agent
    const byPersona = new Map<string, typeof executions>();
    for (const exec of executions) {
      const list = byPersona.get(exec.personaId);
      if (list) list.push(exec);
      else byPersona.set(exec.personaId, [exec]);
    }

    const agentTabs = Array.from(byPersona.entries()).map(([personaId, execs]) => {
      const persona = personas.find((p) => p.id === personaId);
      const name = persona?.displayName || persona?.name || 'Agent';
      return buildAgentTab(personaId, name, execs);
    });

    const ticketTabs = ticket ? [buildTicketTab(ticket)] : [];
    return [...ticketTabs, ...sessionTabs, ...agentTabs];
  }, [sessions, executions, personas, ticket]);

  // Tab engine manages ordering, active tab, DnD, keyboard nav
  const engine = useTabEngine(groupId, allTabs);

  // Resolve the active session (if the active tab represents one)
  const activeSessionId = engine.activeTab?.meta.sessionId as string | undefined;
  const activeSession = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId) ?? null
    : null;

  // Worktree availability
  const isUnavailable = worktree?.worktreeStatus === 'repo_missing' || worktree?.worktreeStatus === 'unavailable';

  // Activating a brand-new tab is two-step: session enters the store asynchronously
  // via zustand, while setActiveTab is a React setState. Calling setActiveTab with a
  // manually-built descriptor before the session propagates to `allTabs` races the
  // auto-select effect in useTabEngine, which then resets the activation and falls
  // back to the ticket tab. We defer activation until the tab actually appears.
  const [pendingActiveKey, setPendingActiveKey] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingActiveKey) return;
    const found = allTabs.find((t) => t.key === pendingActiveKey);
    if (found) {
      engine.setActiveTab(found);
      setPendingActiveKey(null);
    }
  }, [pendingActiveKey, allTabs, engine]);

  const handleNewTab = useCallback(async () => {
    const cwd = worktree?.path || basePath || '~';
    try {
      const session = await api.createSession({ cwd, type: 'shell' });
      addSessionToGroup(session);
      api.fetchSessionGroups().then(setSessionGroups).catch(() => {});
      setPendingActiveKey(`s:${session.id}`);
    } catch {
      // silently fail
    }
  }, [worktree, basePath, addSessionToGroup, setSessionGroups]);

  // Listen for ⌘N "new tab" event
  useEffect(() => {
    if (isUnavailable) return;
    const handler = () => { handleNewTab(); };
    window.addEventListener('fleex:new-tab', handler);
    return () => window.removeEventListener('fleex:new-tab', handler);
  }, [handleNewTab, isUnavailable]);

  // Content rendering — delegates to the active tab kind's Content component
  // Floating logic is handled inline by TerminalTabContent (no guard needed here)
  const renderContent = () => {
    if (!engine.activeTab) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[var(--theme-text-faint)]">
          <span className="text-sm">
            {isUnavailable
              ? (worktree?.worktreeStatus === 'repo_missing' ? 'Repository not found locally' : 'Worktree unavailable')
              : 'No tabs yet'}
          </span>
          {!isUnavailable && (
            <button
              className="rounded-md bg-[var(--theme-accent)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              onClick={handleNewTab}
            >
              + New Shell Tab
            </button>
          )}
        </div>
      );
    }

    const kind = getTabKind(engine.activeTab.kind);
    if (!kind) return null;
    const Content = kind.Content;
    return <Content tab={engine.activeTab} />;
  };

  return (
    <div
      className={`flex flex-1 flex-col overflow-hidden transition-all duration-200${
        isSplit && focused ? ' session-pane-focused' : ''
      }${isSplit && !focused ? ' session-pane-unfocused' : ''}`}
      onClick={onFocus}
    >
      <WorktreeHeader
        worktree={worktree}
        repoOrg={repoOrg}
        repoName={repoName}
        activeSession={activeSession}
        ticket={ticket}
        splitFocused={isSplit && focused}
      />
      <TabBar
        tabs={engine.orderedTabs}
        activeTabKey={engine.activeTab?.key ?? null}
        onSelect={engine.setActiveTab}
        onClose={engine.closeTab}
        onRename={engine.renameTab}
        trailing={
          !isUnavailable && (
            <SmartSessionButton
              sessions={sessions}
              onCreateSession={handleNewTab}
              disabled={isUnavailable}
              size="sm"
              ticketId={ticket?.id}
              onExecuteSkill={
                ticket
                  ? (skillId) => api.executeSkill(skillId, ticket.id).catch(console.error)
                  : undefined
              }
              alwaysShowMenu
            />
          )
        }
        drag={engine.drag}
      />
      {renderContent()}
    </div>
  );
}
