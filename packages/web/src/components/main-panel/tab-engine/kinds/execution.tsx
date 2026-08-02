import type { AgentExecution } from '@fleex/shared';

import { cn } from '../../../../lib/cn';
import { tintText, tintSolid } from '../../../../lib/tints';
import { AgentExecutionsPanel } from '../../AgentExecutionsPanel';
import { registerTabKind } from '../registry';

import type { TabDescriptor, TabIconProps, TabContentProps, TabStatusProps } from '../types';

// ——— Icon ———

function ExecutionIcon(_props: TabIconProps) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', tintText('purple'))}
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

// ——— Status ———

const STATUS_BG: Record<string, string> = {
  running: tintSolid('blue'),
  completed: tintSolid('green'),
  failed: tintSolid('red'),
};

function ExecutionStatus({ tab }: TabStatusProps) {
  // Show running status if any execution is running
  const hasRunning = tab.meta.hasRunning as boolean | undefined;
  const bg = hasRunning
    ? STATUS_BG['running']
    : (STATUS_BG['completed'] ?? 'bg-[var(--theme-text-faint)]');
  return <span className={cn('w-1.5 h-1.5 rounded-full', bg)} />;
}

// ——— Content ———

function ExecutionContent({ tab }: TabContentProps) {
  const executions = tab.meta.executions as AgentExecution[];
  return <AgentExecutionsPanel executions={executions} />;
}

// ——— Registration ———

registerTabKind('execution', {
  Icon: ExecutionIcon,
  Content: ExecutionContent,
  StatusIndicator: ExecutionStatus,
  defaultCapabilities: { closable: false, renamable: false, orderable: true, floatable: false },
});

// ——— Builder ———

/** Build one tab per agent (persona), containing all its executions. */
export function buildAgentTab(
  personaId: string,
  personaName: string,
  executions: AgentExecution[],
): TabDescriptor {
  const hasRunning = executions.some((e) => e.status === 'running');
  return {
    key: `a:${personaId}`,
    kind: 'execution',
    label: `${personaName} (${executions.length})`,
    capabilities: { closable: false, renamable: false, orderable: true, floatable: false },
    meta: {
      personaId,
      executions,
      hasRunning,
    },
  };
}

/** @deprecated Use buildAgentTab instead. Kept for backward compatibility. */
export function buildExecutionTab(execution: AgentExecution): TabDescriptor {
  const time = new Date(execution.startedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return {
    key: `e:${execution.id}`,
    kind: 'execution',
    label: time,
    capabilities: { closable: false, renamable: false, orderable: true, floatable: false },
    meta: {
      executionId: execution.id,
      executionStatus: execution.status,
      eventCount: execution.eventCount,
    },
  };
}
