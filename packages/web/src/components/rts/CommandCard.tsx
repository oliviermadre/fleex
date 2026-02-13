import { memo, useCallback } from 'react';
import type { Session } from '@asm/shared';
import type { RtsSelection } from '../../stores/uiStore';
import type { RtsMapModel } from './useRtsMapLayout';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import * as api from '../../services/api';
import { ZERG } from './rtsTheme';

interface CommandCardProps {
  rtsSelection: RtsSelection;
  sessions: Session[];
  mapModel: RtsMapModel;
  onFocusSession: (sessionId: string) => void;
}

interface CommandButton {
  label: string;
  hotkey: string;
  icon: string;
  disabled: boolean;
  action: () => void;
}

export const CommandCard = memo(function CommandCard({ rtsSelection, sessions, mapModel, onFocusSession }: CommandCardProps) {
  const addSession = useSessionStore((s) => s.addSession);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const setActivePanel = useUIStore((s) => s.setActivePanel);
  const openCreateModal = useUIStore((s) => s.openCreateModal);

  const killSession = useCallback(async (id: string) => {
    if (!confirm('Kill this session?')) return;
    try {
      await api.killSession(id);
    } catch { /* ignore */ }
  }, []);

  const createShellSession = useCallback(async (cwd: string) => {
    try {
      const session = await api.createSession({ cwd, type: 'shell' });
      addSession(session);
      const groups = await api.fetchSessionGroups();
      setSessionGroups(groups);
    } catch { /* ignore */ }
  }, [addSession, setSessionGroups]);

  const createClaudeSession = useCallback(async (cwd: string) => {
    try {
      const session = await api.createSession({ cwd, type: 'claude' });
      addSession(session);
      const groups = await api.fetchSessionGroups();
      setSessionGroups(groups);
    } catch { /* ignore */ }
  }, [addSession, setSessionGroups]);

  let buttons: (CommandButton | null)[] = Array(9).fill(null);

  if (rtsSelection?.type === 'session') {
    const session = sessions.find((s) => s.id === rtsSelection.sessionId);
    if (session) {
      buttons[0] = {
        label: 'Focus',
        hotkey: 'S',
        icon: '👁',
        disabled: false,
        action: () => onFocusSession(session.id),
      };
      buttons[1] = {
        label: 'Kill',
        hotkey: 'K',
        icon: '💀',
        disabled: false,
        action: () => killSession(session.id),
      };
    }
  } else if (rtsSelection?.type === 'worktree') {
    const base = mapModel.bases.find((b) => b.repoKey === rtsSelection.repoKey);
    const wt = base?.worktrees.find((w) => w.branch === rtsSelection.branch);
    const cwd = wt?.path ?? '~';

    buttons[0] = {
      label: 'New Shell',
      hotkey: 'N',
      icon: '🐚',
      disabled: false,
      action: () => createShellSession(cwd),
    };
    buttons[1] = {
      label: 'New Claude',
      hotkey: 'C',
      icon: '🤖',
      disabled: false,
      action: () => createClaudeSession(cwd),
    };
    buttons[2] = {
      label: 'Open PR',
      hotkey: 'G',
      icon: '🔗',
      disabled: false,
      action: () => {
        if (base) {
          window.open(`https://github.com/${base.org}/${base.name}/compare/${rtsSelection.branch}`, '_blank');
        }
      },
    };
  } else if (rtsSelection?.type === 'hatchery') {
    buttons[0] = {
      label: 'Dashboard',
      hotkey: 'D',
      icon: '📊',
      disabled: false,
      action: () => {
        useUIStore.getState().selectRepo(rtsSelection.repoKey);
        setActivePanel('repositories');
      },
    };
    buttons[1] = {
      label: 'Refresh',
      hotkey: 'R',
      icon: '🔄',
      disabled: false,
      action: () => {
        const [org, name] = rtsSelection.repoKey.split('/');
        api.requestRepositoryRefresh('repo', org, name).catch(() => {});
      },
    };
    buttons[2] = {
      label: 'Create',
      hotkey: 'N',
      icon: '➕',
      disabled: false,
      action: () => openCreateModal(),
    };
  }

  return (
    <div
      className="rts-panel"
      style={{
        width: 240,
        borderRadius: 4,
        padding: 8,
        flexShrink: 0,
      }}
    >
      {/* 3x3 grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(3, 1fr)',
          gap: 4,
          height: '100%',
        }}
      >
        {buttons.map((btn, i) => (
          <CommandSlot key={i} button={btn} />
        ))}
      </div>
    </div>
  );
});

function CommandSlot({ button }: { button: CommandButton | null }) {
  if (!button) {
    return (
      <div
        style={{
          background: 'rgba(20, 10, 35, 0.5)',
          borderRadius: 3,
          border: `1px solid ${ZERG.carapaceBorderDim}33`,
        }}
      />
    );
  }

  return (
    <button
      onClick={button.action}
      disabled={button.disabled}
      style={{
        background: button.disabled
          ? 'rgba(20, 10, 35, 0.3)'
          : 'linear-gradient(180deg, rgba(40, 20, 65, 0.8) 0%, rgba(20, 10, 35, 0.9) 100%)',
        borderRadius: 3,
        border: `1px solid ${button.disabled ? ZERG.carapaceBorderDim + '33' : ZERG.carapaceBorderDim}`,
        cursor: button.disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        padding: 4,
        position: 'relative',
        opacity: button.disabled ? 0.3 : 1,
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        if (!button.disabled) {
          (e.currentTarget as HTMLElement).style.borderColor = ZERG.selectionRing;
          (e.currentTarget as HTMLElement).style.boxShadow = `0 0 8px ${ZERG.selectionGlow}`;
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = ZERG.carapaceBorderDim;
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>{button.icon}</span>
      <span style={{ color: ZERG.textSecondary, fontSize: 8, lineHeight: 1 }}>{button.label}</span>

      {/* Hotkey badge */}
      <span
        style={{
          position: 'absolute',
          bottom: 2,
          right: 3,
          fontSize: 7,
          fontWeight: 700,
          color: ZERG.textFaint,
          fontFamily: 'monospace',
        }}
      >
        {button.hotkey}
      </span>
    </button>
  );
}
