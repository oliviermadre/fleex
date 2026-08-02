import type { Session } from '@fleex/shared';
import { StatusDot } from '../../../ui/StatusDot';
import { deriveDisplayStatus } from '../../../../lib/deriveStatus';
import type { DisplayStatus } from '../../../../lib/deriveStatus';
import { useSessionStore } from '../../../../stores/sessionStore';
import * as api from '../../../../services/api';
import { registerTabKind } from '../registry';
import { LazyTerminalTabContent } from './LazyTerminalTabContent';
import type { TabDescriptor, TabIconProps, TabStatusProps } from '../types';

// ——— Icon ———

function ClaudeIcon(_props: TabIconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

// ——— Status ———

function ClaudeStatus({ tab }: TabStatusProps) {
  const status = (tab.meta.displayStatus as DisplayStatus | undefined) ?? 'unknown';
  return <StatusDot status={status} size="sm" />;
}

// ——— Registration ———

registerTabKind('claude', {
  Icon: ClaudeIcon,
  Content: LazyTerminalTabContent,
  StatusIndicator: ClaudeStatus,
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
    useSessionStore.getState().setSessions(sessions.map((s) => (s.id === updated.id ? updated : s)));
  },
});

// ——— Builder ———

export function buildClaudeTab(session: Session): TabDescriptor {
  const status = deriveDisplayStatus(session);
  return {
    key: `c:${session.id}`,
    kind: 'claude',
    label: session.displayName || session.tmuxName || session.id.slice(0, 8),
    capabilities: { closable: true, renamable: true, orderable: true, floatable: true },
    meta: { sessionId: session.id, displayStatus: status.status },
  };
}
