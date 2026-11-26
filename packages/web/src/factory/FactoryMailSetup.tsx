import { useCallback, useEffect, useState } from 'react';
import { GOGCLI_INSTALL_COMMAND, GOGCLI_SETUP_URL } from '@fleex/shared';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';
import { toast } from '../lib/toast';
import { factoryApi, type MailStatus } from './factoryApi';

function Cmd({ children }: { children: string }) {
  return (
    <code className="block select-all truncate rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--theme-text-secondary)]" title={children}>
      {children}
    </code>
  );
}

/** Whether the mailbox can be read, asked once per intake panel; `check` asks gog again. */
export function useMailStatus(): { status: MailStatus | null; checking: boolean; check: () => Promise<MailStatus | null> } {
  const [status, setStatus] = useState<MailStatus | null>(null), [checking, setChecking] = useState(false);
  const check = useCallback(async (refresh = true) => {
    setChecking(true);
    try { const s = await factoryApi.mailStatus(refresh); setStatus(s); return s; } catch { return null; } finally { setChecking(false); }
  }, []);
  useEffect(() => { void check(false); }, [check]);
  return { status, checking, check: () => check(true) };
}

/**
 * A Gmail intake needs gogcli, as the agenda does: a separate tool, installed and authorized on the machine running
 * Fleex, not in Fleex (Fleex runs no OAuth flow and keeps no Google token). Until gog can read Gmail, the setup steps;
 * then one line: the tool, its version, the account.
 */
export function FactoryMailSetup({ mail }: { mail: ReturnType<typeof useMailStatus> }) {
  const { status, checking } = mail;
  if (!status) return <p className="text-xs text-[var(--theme-text-muted)]">{checking ? 'Asking gogcli whether it can read Gmail…' : 'Could not ask the server whether Gmail can be read.'}</p>;
  if (status.connected) {
    return (
      <p className="text-xs text-[var(--theme-text-muted)]" data-testid="mail-ready">
        <span className="text-[var(--theme-success)]">●</span> Read through gogcli{status.version ? ` ${status.version}` : ''}{status.account ? ` · ${status.account}` : ''}, read-only
      </p>
    );
  }
  const check = async () => {
    const now = await mail.check();
    if (now?.connected) toast.success('Gmail is readable through gogcli');
    else toast.info(now?.installed ? 'gogcli is installed but cannot read Gmail yet' : 'gogcli is not installed on the Fleex server yet');
  };
  const steps: { label: string; cmd?: string; done: boolean }[] = [
    { label: 'Install gogcli on the machine running Fleex', cmd: GOGCLI_INSTALL_COMMAND, done: status.installed },
    { label: 'Google Cloud project: enable the Gmail API, create a Desktop OAuth client, then', cmd: 'gog auth credentials <client_secret.json>', done: false },
    { label: 'Authorize your account for Gmail, read-only (already set up for the agenda? add gmail to its services)', cmd: 'gog auth add you@example.com --services gmail --gmail-scope readonly', done: false },
  ];
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] p-2 text-xs text-[var(--theme-text-muted)]" data-testid="mail-setup">
      <p><b className="text-[var(--theme-text-secondary)]">gogcli required.</b> Gmail is read through gogcli, a separate tool set up on the machine running Fleex, as for the agenda. Until it can read Gmail, this intake pulls nothing.</p>
      <ol className="flex flex-col gap-1">
        {steps.map((s, i) => (
          <li key={s.label} className="flex flex-col gap-0.5">
            <span className={cn(s.done && 'text-[var(--theme-text-faint)] line-through')}>{i + 1}. {s.label}{s.done ? ' ✓' : ''}</span>
            {s.cmd && !s.done && <Cmd>{s.cmd}</Cmd>}
          </li>
        ))}
      </ol>
      <p>Another account than gog's default: set <code className="font-mono">FLEEX_GOG_ACCOUNT</code> for the Fleex server.</p>
      {status.installed && status.error && <p className="line-clamp-3 text-[var(--theme-warning)]" role="alert" title={status.error}>{status.error}</p>}
      <div className="flex items-center gap-2">
        <a href={status.setupUrl ?? GOGCLI_SETUP_URL} target="_blank" rel="noreferrer" className="text-[var(--theme-accent)] hover:underline">Setup guide ↗</a>
        <Button size="sm" variant="secondary" disabled={checking} onClick={() => void check()}>{checking ? 'Checking…' : 'Check again'}</Button>
      </div>
    </div>
  );
}
