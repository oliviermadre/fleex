import { memo } from 'react';
import type { Session } from '@asm/shared';
import type { OfficeSelection, OfficeMapModel } from './types';
import { useOfficeActions } from './useOfficeActions';
import { OFFICE } from './officeTheme';

interface OfficeCommandCardProps {
  selection: OfficeSelection;
  sessions: Session[];
  mapModel: OfficeMapModel;
  onFocusSession: (sessionId: string) => void;
  onToast?: (message: string) => void;
}

interface CommandButton {
  label: string;
  hotkey: string;
  icon: string;
  disabled: boolean;
  action: () => void;
}

export const OfficeCommandCard = memo(function OfficeCommandCard({
  selection,
  sessions,
  mapModel,
  onFocusSession,
  onToast,
}: OfficeCommandCardProps) {
  const actions = useOfficeActions({ selection, sessions, mapModel, onFocusSession, onToast });

  let buttons: (CommandButton | null)[] = Array(9).fill(null);

  if (selection?.type === 'session') {
    const session = sessions.find((s) => s.id === selection.sessionId);
    if (session) {
      buttons[0] = {
        label: 'Focus',
        hotkey: 'S',
        icon: '👁',
        disabled: false,
        action: actions.focusSession,
      };
      buttons[1] = {
        label: 'Kill',
        hotkey: 'K',
        icon: '💀',
        disabled: false,
        action: actions.killSession,
      };
    }
  } else if (selection?.type === 'worktree') {
    buttons[0] = {
      label: 'New Shell',
      hotkey: 'N',
      icon: '💻',
      disabled: false,
      action: actions.createShell,
    };
    buttons[1] = {
      label: 'New Claude',
      hotkey: 'C',
      icon: '🤖',
      disabled: false,
      action: actions.createClaude,
    };
    buttons[2] = {
      label: 'Open PR',
      hotkey: 'G',
      icon: '🔗',
      disabled: false,
      action: actions.openPR,
    };
    buttons[3] = {
      label: 'Scratchpad',
      hotkey: 'P',
      icon: '📋',
      disabled: false,
      action: actions.openScratchpad,
    };
  } else if (selection?.type === 'repo') {
    buttons[0] = {
      label: 'Dashboard',
      hotkey: 'D',
      icon: '📊',
      disabled: false,
      action: actions.openDashboard,
    };
    buttons[1] = {
      label: 'Refresh',
      hotkey: 'R',
      icon: '🔄',
      disabled: false,
      action: actions.refreshRepo,
    };
    buttons[2] = {
      label: 'Create',
      hotkey: 'N',
      icon: '➕',
      disabled: false,
      action: actions.openCreateModal,
    };
    buttons[3] = {
      label: 'Scratchpad',
      hotkey: 'P',
      icon: '📋',
      disabled: false,
      action: actions.openScratchpad,
    };
  }

  return (
    <div
      className="office-panel"
      style={{
        width: 240,
        borderRadius: 4,
        padding: 8,
        flexShrink: 0,
      }}
    >
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
          background: 'rgba(26, 29, 35, 0.5)',
          borderRadius: 3,
          border: `1px solid ${OFFICE.panelBorderDim}33`,
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
          ? 'rgba(26, 29, 35, 0.3)'
          : 'linear-gradient(180deg, rgba(55, 65, 81, 0.8) 0%, rgba(26, 29, 35, 0.9) 100%)',
        borderRadius: 3,
        border: `1px solid ${button.disabled ? OFFICE.panelBorderDim + '33' : OFFICE.panelBorderDim}`,
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
          (e.currentTarget as HTMLElement).style.borderColor = OFFICE.selectionBlue;
          (e.currentTarget as HTMLElement).style.boxShadow = `0 0 8px ${OFFICE.selectionGlow}`;
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = OFFICE.panelBorderDim;
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>{button.icon}</span>
      <span style={{ color: OFFICE.textSecondary, fontSize: 8, lineHeight: 1 }}>{button.label}</span>

      <span
        style={{
          position: 'absolute',
          bottom: 2,
          right: 3,
          fontSize: 7,
          fontWeight: 700,
          color: OFFICE.textFaint,
          fontFamily: 'monospace',
        }}
      >
        {button.hotkey}
      </span>
    </button>
  );
}
