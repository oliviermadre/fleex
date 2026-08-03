import type { Session } from '@fleex/shared';

import { deriveDisplayStatus } from '../../../../lib/deriveStatus';
import * as api from '../../../../services/api';
import { useSessionStore } from '../../../../stores/sessionStore';
import { StatusDot } from '../../../ui/StatusDot';
import { registerTabKind } from '../registry';

import { LazyTerminalTabContent } from './LazyTerminalTabContent';

import type { DisplayStatus } from '../../../../lib/deriveStatus';
import type { TabDescriptor, TabIconProps, TabStatusProps } from '../types';

// ——— Icon ———

function ShellIcon(_props: TabIconProps) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M4 5l3 3-3 3" />
      <line x1="9" y1="11" x2="12" y2="11" />
    </svg>
  );
}

// ——— Status ———

function ShellStatus({ tab }: TabStatusProps) {
  const status = (tab.meta.displayStatus as DisplayStatus | undefined) ?? 'unknown';
  return <StatusDot status={status} size="sm" />;
}

// ——— Registration ———

registerTabKind('shell', {
  Icon: ShellIcon,
  Content: LazyTerminalTabContent,
  StatusIndicator: ShellStatus,
  defaultCapabilities: { closable: true, renamable: true, orderable: true, floatable: true },

  onClose: async (tab) => {
    const sessionId = tab.meta.sessionId as string;
    await api.killSession(sessionId);
    useSessionStore.getState().removeSession(sessionId);
  },

  onRename: async (tab, newName) => {
    const sessionId = tab.meta.sessionId as string;
    const updated = await api.renameSession(sessionId, newName);
    const { sessions } = useSessionStore.getState();
    useSessionStore
      .getState()
      .setSessions(sessions.map((s) => (s.id === updated.id ? updated : s)));
  },
});

// ——— Builder ———

export function buildShellTab(session: Session): TabDescriptor {
  const status = deriveDisplayStatus(session);
  return {
    key: `s:${session.id}`,
    kind: 'shell',
    label: session.displayName || session.tmuxName || session.id.slice(0, 8),
    capabilities: { closable: true, renamable: true, orderable: true, floatable: true },
    meta: { sessionId: session.id, displayStatus: status.status },
  };
}
