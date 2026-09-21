import { useEffect } from 'react';
import { slackReadsDirectly, useConnectorStore } from '../../../stores/connectorStore';

/** Loads the connector status once and exposes it to the new-task screens. */
function useSlackStatus() {
  const slack = useConnectorStore((s) => s.slack);
  const loadSlack = useConnectorStore((s) => s.loadSlack);
  useEffect(() => {
    if (slack === null) void loadSlack();
  }, [slack, loadSlack]);
  return slack;
}

/** Will a Slack link from `workspace` take the fast path? See {@link slackReadsDirectly}. */
export function useSlackDirect(workspace: string | undefined): boolean {
  return slackReadsDirectly(useSlackStatus(), workspace);
}

/** Is a Slack token saved at all (for whichever workspace)? */
export function useSlackConnected(): boolean {
  return useSlackStatus()?.connected === true;
}
