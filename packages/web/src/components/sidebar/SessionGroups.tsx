import { useSessionStore } from '../../stores/sessionStore';
import { RepositoryGroup } from './RepositoryGroup';

export function SessionGroups() {
  const sessionGroups = useSessionStore((s) => s.sessionGroups);

  if (sessionGroups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-xs text-zinc-500">No sessions</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {sessionGroups.map((group) => (
        <RepositoryGroup
          key={`${group.repositoryOrg}/${group.repositoryName}`}
          group={group}
        />
      ))}
    </div>
  );
}
