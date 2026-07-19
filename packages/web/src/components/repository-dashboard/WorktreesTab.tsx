import type { RepositoryDashboardData } from '@fleex/shared';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { TicketsWorktreesPanel } from './TicketsWorktreesPanel';
import { useWorktreeRows } from './useWorktreeRows';

interface Props {
  org: string;
  name: string;
  data: RepositoryDashboardData;
}

export function WorktreesTab({ org, name, data }: Props) {
  const fetchDashboard = useRepositoryDashboardStore((s) => s.fetchDashboard);
  const rows = useWorktreeRows(org, name, data);

  return <TicketsWorktreesPanel org={org} name={name} rows={rows} onDeleted={() => fetchDashboard(org, name)} />;
}
