import { RepoActionsSettings } from './worktree-settings/RepoActionsSettings';
import { RepoNamedActions } from '../../factory/NamedActions';

interface Props {
  org: string;
  name: string;
}

/**
 * The repo's Config tab: its worktree Actions et Hooks (lifecycle, actions,
 * detected commands, options). The former post-checkout field is the Setup step.
 */
export function RepoConfigPanel({ org, name }: Props) {
  return (
    <>
      <RepoActionsSettings org={org} name={name} />
      <RepoNamedActions org={org} name={name} />
    </>
  );
}
