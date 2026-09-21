import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { useConnectorStore } from '../../stores/connectorStore';
import { tint } from '../../lib/tints';
import { cn } from '../../lib/cn';

/** What each history scope unlocks, in the user's words. */
const SCOPE_MEANING: Record<string, string> = {
  'channels:history': 'public channels',
  'groups:history': 'private channels',
  'im:history': 'direct messages',
  'mpim:history': 'group direct messages',
};

/**
 * Settings → Connectors. One connector for now: Slack, by user token. With it,
 * importing a Slack conversation reads the Slack API directly instead of having
 * Claude fetch the messages through MCP — seconds instead of tens of seconds.
 *
 * The token field is write-only by design: once saved it is never shown again
 * (the server never sends it back), only who it belongs to and its last 4 chars.
 */
export function ConnectorsTab() {
  const slack = useConnectorStore((s) => s.slack);
  const loadSlack = useConnectorStore((s) => s.loadSlack);
  const connectSlack = useConnectorStore((s) => s.connectSlack);
  const disconnectSlack = useConnectorStore((s) => s.disconnectSlack);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSlack(true);
  }, [loadSlack]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await connectSlack(token.trim());
      setToken(''); // do not keep the secret in the DOM once it is saved
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the token.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await disconnectSlack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">Slack</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--theme-text-muted)]">
        With a Slack user token, Fleex reads a conversation straight from the Slack API when you import it, and only
        asks Claude to write the summary. Without one, Claude fetches the messages itself through your Slack
        integration — it works, but it is slower and costs more.
      </p>

      {slack?.connected ? (
        <div className="mt-4 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-4">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--theme-accent)]" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-[var(--theme-text-primary)]">
                Connected to <span className="font-medium">{slack.teamName}</span> as{' '}
                <span className="font-medium">@{slack.userName}</span>
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-[var(--theme-text-muted)]">
                {slack.teamDomain}.slack.com · {slack.tokenHint}
              </p>
            </div>
            <Button variant="ghost" onClick={disconnect} disabled={busy}>
              Disconnect
            </Button>
          </div>
          {slack.missingScopes.length > 0 && (
            <div className={cn('mt-3 rounded px-3 py-2 text-xs leading-relaxed', tint('yellow'))}>
              This token can't read {slack.missingScopes.map((s) => SCOPE_MEANING[s] ?? s).join(', ')}. Add{' '}
              <span className="font-mono">{slack.missingScopes.join(', ')}</span> to your Slack app's User Token Scopes,
              reinstall it, and paste the new token.
            </div>
          )}
          <p className="mt-3 text-xs text-[var(--theme-text-muted)]">
            Links from other workspaces still go through Claude. To switch workspace or rotate the token, paste a new
            one below.
          </p>
        </div>
      ) : (
        <p className="mt-4 text-xs text-[var(--theme-text-secondary)]">
          {slack === null ? 'Checking…' : 'Not connected — Slack imports go through Claude.'}
        </p>
      )}

      <form onSubmit={submit} className="mt-4">
        <label htmlFor="slack-token" className="text-xs font-medium text-[var(--theme-text-secondary)]">
          {slack?.connected ? 'Replace the user token' : 'User token'}
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="slack-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError(null);
            }}
            placeholder="xoxp-…"
            aria-invalid={!!error}
            aria-describedby={error ? 'slack-token-error' : undefined}
            className="min-w-0 flex-1 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-3 py-1.5 font-mono text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
          />
          <Button type="submit" variant="primary" disabled={!token.trim() || busy}>
            {busy ? 'Checking…' : slack?.connected ? 'Replace' : 'Connect'}
          </Button>
        </div>
        {error && (
          <p id="slack-token-error" role="alert" className={cn('mt-2 rounded px-3 py-2 text-xs', tint('red'))}>
            {error}
          </p>
        )}
      </form>

      <details className="mt-5 text-xs text-[var(--theme-text-muted)]">
        <summary className="cursor-pointer text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]">
          How to get a user token
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 leading-relaxed">
          <li>
            Create an app at <span className="font-mono">api.slack.com/apps</span> → From scratch, in your workspace.
          </li>
          <li>
            OAuth &amp; Permissions → <span className="font-medium">User Token Scopes</span> (not Bot): add{' '}
            <span className="font-mono">channels:history, groups:history, im:history, mpim:history, users:read</span>.
          </li>
          <li>Install to Workspace, then copy the User OAuth Token — it starts with <span className="font-mono">xoxp-</span>.</li>
        </ol>
        <p className="mt-2 leading-relaxed">
          The token is checked with Slack, then kept on this machine in{' '}
          <span className="font-mono">~/.fleex/connectors/slack.json</span>, readable by you only. It is not stored in
          the Fleex database and is never sent back to the browser. It can read what you can read in Slack, so treat
          it like a password.
        </p>
      </details>
    </div>
  );
}
