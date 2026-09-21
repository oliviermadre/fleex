/** A Slack workspace Fleex can read directly, with the user token that allows it. */
export interface SlackConnection {
  /** Slack USER token (`xoxp-…`). Secret: never returned by the API, never logged. */
  readonly token: string;
  readonly teamId: string;
  readonly teamName: string;
  /** Workspace subdomain (`acme`), matched against a permalink's host. */
  readonly teamDomain: string;
  readonly userId: string;
  readonly userName: string;
  readonly scopes: string[];
  readonly connectedAt: string;
}

/**
 * Where the Slack connection lives. Deliberately NOT the app config: that is
 * stored in the database (a remote one on Supabase) and served whole by
 * `GET /api/config`. A user token reads everything its owner can — DMs included.
 */
export interface SlackConnectionStore {
  get(): Promise<SlackConnection | null>;
  save(connection: SlackConnection): Promise<void>;
  clear(): Promise<void>;
}
