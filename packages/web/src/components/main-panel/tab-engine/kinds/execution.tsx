import type { AgentExecution } from '@fleex/shared';
import { cn } from '../../../../lib/cn';
import { AgentEventStream } from '../../AgentEventStream';
import { registerTabKind } from '../registry';
import type { TabDescriptor, TabIconProps, TabContentProps, TabStatusProps } from '../types';

// ——— Icon ———

function ExecutionIcon(_props: TabIconProps) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-violet-400">
      <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
    </svg>
  );
}

// ——— Status ———

const STATUS_BG: Record<string, string> = {
  running: 'bg-blue-400',
  completed: 'bg-green-400',
  failed: 'bg-red-400',
};

function ExecutionStatus({ tab }: TabStatusProps) {
  const status = tab.meta.executionStatus as string | undefined;
  const bg = (status && STATUS_BG[status]) || 'bg-[var(--theme-text-faint)]';
  return <span className={cn('w-1.5 h-1.5 rounded-full', bg)} />;
}

// ——— Content ———

function ExecutionContent({ tab }: TabContentProps) {
  const executionId = tab.meta.executionId as string;
  return <AgentEventStream executionId={executionId} />;
}

// ——— Registration ———

registerTabKind('execution', {
  Icon: ExecutionIcon,
  Content: ExecutionContent,
  StatusIndicator: ExecutionStatus,
  defaultCapabilities: { closable: false, renamable: false, orderable: true },
  // Executions cannot be closed or renamed — no onClose/onRename needed
});

// ——— Builder ———

export function buildExecutionTab(execution: AgentExecution): TabDescriptor {
  const time = new Date(execution.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return {
    key: `e:${execution.id}`,
    kind: 'execution',
    label: time,
    capabilities: { closable: false, renamable: false, orderable: true },
    meta: {
      executionId: execution.id,
      executionStatus: execution.status,
      eventCount: execution.eventCount,
    },
  };
}
