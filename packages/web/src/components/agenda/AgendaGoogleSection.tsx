import { useState } from 'react';
import { GOGCLI_INSTALL_COMMAND, type AgendaGoogleStatus } from '@fleex/shared';
import { useAgendaStore } from '../../stores/agendaStore';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { CheckIcon, ExternalLinkIcon } from '../ui/icons/AgendaIcons';
import { AlertIcon } from '../ui/icons/AnnotationIcons';

function Box({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return (
    <span
      className={cn('grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] text-[var(--theme-bg-base)]', disabled && 'opacity-50')}
      style={{ border: '1.5px solid var(--tint-blue-solid)', background: on ? 'var(--tint-blue-solid)' : 'transparent' }}
    >
      {on ? <CheckIcon size={10} className="[stroke-width:3]" /> : null}
    </span>
  );
}

function SetupLink({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-[var(--theme-accent)] hover:underline"
    >
      {children}
      <ExternalLinkIcon size={10} />
    </a>
  );
}

function Cmd({ children }: { children: string }) {
  return (
    <code className="block truncate rounded bg-[var(--theme-bg-overlay)] px-1 py-px font-mono text-[10px] text-[var(--theme-text-secondary)]" title={children}>
      {children}
    </code>
  );
}

/** The gogcli setup, done on the Fleex server host — Fleex has no OAuth flow of its own. */
function SetupSteps({ google }: { google: AgendaGoogleStatus }) {
  const [checking, setChecking] = useState(false);
  const steps: { label: string; cmd?: string; done: boolean }[] = [
    { label: 'Install gogcli', cmd: GOGCLI_INSTALL_COMMAND, done: google.installed },
    { label: 'Google Cloud project: enable the Calendar API, create a Desktop OAuth client, then', cmd: 'gog auth credentials <client_secret.json>', done: false },
    { label: 'Authorize your account (calendar access, so you can answer invitations from Fleex)', cmd: 'gog auth add you@example.com --services calendar', done: false },
  ];
  const check = async () => {
    setChecking(true);
    try {
      await useAgendaStore.getState().loadGoogle(true);
      const now = useAgendaStore.getState().google;
      if (now?.connected) {
        toast.success('Google Calendar is readable through gogcli');
        void useAgendaStore.getState().refresh();
      } else {
        toast.info(now?.installed ? 'gogcli is installed but not authorized yet' : 'gogcli is not installed on the Fleex server yet');
      }
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="space-y-1.5 p-1 text-[11px] text-[var(--theme-text-muted)]" data-testid="agenda-google">
      <p>
        Google Calendar is read through <strong className="text-[var(--theme-text-secondary)]">gogcli</strong>, a separate
        tool set up on the machine running Fleex — not in Fleex.
      </p>
      <ol className="space-y-1">
        {steps.map((s, i) => (
          <li key={s.label} className="space-y-0.5">
            <div className={cn('flex items-start gap-1', s.done && 'text-[var(--theme-text-faint)] line-through')}>
              <span className="shrink-0 tabular-nums">{i + 1}.</span>
              <span>{s.label}</span>
              {s.done && <CheckIcon size={10} className="mt-0.5 shrink-0 text-[var(--theme-success)]" />}
            </div>
            {s.cmd && !s.done && <Cmd>{s.cmd}</Cmd>}
          </li>
        ))}
      </ol>
      {google.installed && google.error && (
        <div className="flex items-start gap-1.5 text-[var(--theme-warning)]" role="alert">
          <AlertIcon size={12} className="mt-px shrink-0" />
          <span className="line-clamp-3" title={google.error}>{google.error}</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <SetupLink url={google.setupUrl}>Setup guide</SetupLink>
        <Button size="sm" variant="secondary" disabled={checking} onClick={() => void check()}>
          {checking ? 'Checking…' : 'Check again'}
        </Button>
      </div>
    </div>
  );
}

/**
 * E3 — Google Calendar in the agenda sidebar. Read through gogcli (`gog`),
 * installed and authorized outside Fleex: the section guides the setup until
 * gog can read calendars, then lets the user pick the calendars to show.
 */
export function AgendaGoogleSection() {
  const google = useAgendaStore((s) => s.google);
  const prefs = useAgendaStore((s) => s.prefs);
  const updatePrefs = useAgendaStore((s) => s.updatePrefs);
  const externalError = useAgendaStore((s) => s.data?.errors?.external ?? null);

  if (!google) return null;
  if (!google.connected) return <SetupSteps google={google} />;

  const warning = (externalError || google.error) && (
    <div className="flex items-start gap-1.5 text-[11px] text-[var(--theme-warning)]" role="alert">
      <AlertIcon size={12} className="mt-px shrink-0" />
      <span>{externalError || google.error}</span>
    </div>
  );

  const primaryIds = google.calendars.filter((c) => c.primary).map((c) => c.id);
  const selected = new Set(prefs.googleCalendars.length ? prefs.googleCalendars : primaryIds);
  const toggleCalendar = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const list = google.calendars.map((c) => c.id).filter((c) => next.has(c));
    updatePrefs((p) => ({ ...p, googleCalendars: list }));
    void useAgendaStore.getState().refresh();
  };

  // Primary first, then the others by name.
  const calendars = [...google.calendars].sort((a, b) =>
    Number(!!b.primary) - Number(!!a.primary) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return (
    <div className="space-y-0.5 p-1" data-testid="agenda-google">
      <div className="truncate text-[11px] text-[var(--theme-text-muted)]" title={google.email ?? undefined}>{google.email ?? 'Connected'}</div>
      {calendars.map((c) => {
        const on = selected.has(c.id);
        // The last calendar can't be unticked: an empty list means "primary only".
        const locked = on && selected.size === 1;
        return (
          <button
            key={c.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={locked}
            title={locked ? 'At least one calendar is read' : c.name}
            onClick={() => toggleCalendar(c.id)}
            className={cn('flex w-full items-center gap-2 rounded py-0.5 pr-1 hover:bg-[var(--theme-bg-hover)]', on ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-text-muted)]', locked && 'cursor-default')}
          >
            <Box on={on} />
            <span className="flex-1 truncate text-left">{c.name}</span>
            {c.primary && <span className="text-[10px] text-[var(--theme-text-faint)]">primary</span>}
          </button>
        );
      })}
      <button
        type="button"
        role="checkbox"
        aria-checked={prefs.showWorkingLocation}
        onClick={() => updatePrefs((p) => ({ ...p, showWorkingLocation: !p.showWorkingLocation }))}
        className="flex w-full items-center gap-2 rounded py-0.5 pr-1 text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
      >
        <Box on={prefs.showWorkingLocation} />
        <span className="flex-1 truncate text-left">Show working location</span>
      </button>
      {warning}
      <div className="pt-0.5 text-[10px] text-[var(--theme-text-faint)]" title="Change the account with `gog auth manage` on the Fleex server">
        Read through gogcli{google.version ? ` ${google.version}` : ''} ·{' '}
        <SetupLink url={google.setupUrl}>setup</SetupLink>
      </div>
    </div>
  );
}
