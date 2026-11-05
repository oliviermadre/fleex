import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as api from '../../services/api';
import { useAgendaStore } from '../../stores/agendaStore';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { CheckIcon } from '../ui/icons/AgendaIcons';
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

/** `?google=connected` / `?google_error=<code>` left by the OAuth callback: say it once, then drop the param. */
function useGoogleCallbackParams() {
  const [params, setParams] = useSearchParams();
  const connected = params.get('google');
  const error = params.get('google_error');
  useEffect(() => {
    if (!connected && error === null) return;
    if (connected === 'connected') {
      toast.success('Google Calendar connected');
      void useAgendaStore.getState().loadGoogle().then(() => useAgendaStore.getState().refresh());
    }
    if (error !== null) toast.error(`Couldn't connect Google Calendar${error ? ` (${error})` : ''}`);
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('google');
      next.delete('google_error');
      return next;
    }, { replace: true });
  }, [connected, error, setParams]);
}

/**
 * E3 — Google Calendar in the agenda sidebar: connect, pick the calendars to
 * read, show / hide working-location events, disconnect.
 */
export function AgendaGoogleSection() {
  useGoogleCallbackParams();
  const google = useAgendaStore((s) => s.google);
  const prefs = useAgendaStore((s) => s.prefs);
  const updatePrefs = useAgendaStore((s) => s.updatePrefs);
  const externalError = useAgendaStore((s) => s.data?.errors?.external ?? null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!google) return null;

  const warning = externalError && (
    <div className="flex items-start gap-1.5 text-[11px] text-[var(--theme-warning)]" role="alert">
      <AlertIcon size={12} className="mt-px shrink-0" />
      <span>{externalError}</span>
    </div>
  );

  if (!google.configured) {
    return (
      <div className="space-y-1 py-1 pl-6 pr-1 text-[11px] text-[var(--theme-text-faint)]" data-testid="agenda-google">
        Google Calendar isn't configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
      </div>
    );
  }

  if (!google.connected) {
    return (
      <div className="space-y-1.5 py-1 pl-6 pr-1" data-testid="agenda-google">
        <Button size="sm" onClick={() => { window.location.href = api.agendaGoogleConnectUrl(); }}>
          Connect Google Calendar
        </Button>
        {warning}
      </div>
    );
  }

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

  return (
    <div className="space-y-0.5 py-1 pl-6 pr-1" data-testid="agenda-google">
      <div className="truncate text-[11px] text-[var(--theme-text-muted)]" title={google.email ?? undefined}>{google.email ?? 'Connected'}</div>
      {google.calendars.map((c) => {
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
      <button
        type="button"
        onClick={() => setConfirmDisconnect(true)}
        className="text-[11px] text-[var(--theme-text-muted)] hover:text-[var(--theme-danger)]"
      >
        Disconnect
      </button>
      <ConfirmModal
        open={confirmDisconnect}
        title="Disconnect Google Calendar"
        message={<>Fleex stops reading <strong>{google.email ?? 'this account'}</strong>. Deliverables attached to meetings stay attached.</>}
        confirmLabel="Disconnect"
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await useAgendaStore.getState().disconnectGoogle();
            toast.success('Google Calendar disconnected');
          } catch {
            // `request` already raised the error toast.
          } finally {
            setBusy(false);
            setConfirmDisconnect(false);
          }
        }}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}
