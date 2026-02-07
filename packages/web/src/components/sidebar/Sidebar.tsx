import { SidebarHeader } from './SidebarHeader';
import { SessionGroups } from './SessionGroups';

export function Sidebar() {
  return (
    <div className="flex h-full flex-col border-r border-zinc-800 bg-zinc-900/50">
      <SidebarHeader />
      <SessionGroups />
    </div>
  );
}
