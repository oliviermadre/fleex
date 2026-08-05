import { useEffect, useState } from 'react';
import type { RoutineTrigger, RoutineTriggerKind } from '@fleex/shared';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import * as api from '../../services/api';
import { cn } from '../../lib/cn';
import { tintText } from '../../lib/tints';

/** The zone the browser is in — the only sane default for "9am my time". */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
  } catch {
    return 'Europe/Paris';
  }
}

const KIND_OPTIONS: { value: RoutineTriggerKind; label: string }[] = [
  { value: 'manual', label: 'Manual — only when I hit Launch' },
  { value: 'once', label: 'Once — at a specific date and time' },
  { value: 'cron', label: 'Recurring — on a cron schedule' },
];

/**
 * A handful of expressions covering what routines are actually for. Offered
 * as a starting point, not a cage: the field stays free-text, because the
 * preview below is what tells the author whether their expression is right.
 */
const CRON_PRESETS: { value: string; label: string }[] = [
  { value: '0 9 * * *', label: 'Every day at 09:00' },
  { value: '0 9 * * 1', label: 'Every Monday at 09:00' },
  { value: '0 9 * * 1-5', label: 'Every weekday at 09:00' },
  { value: '0 * * * *', label: 'Every hour' },
  { value: '*/15 * * * *', label: 'Every 15 minutes' },
  { value: '0 9 1 * *', label: 'The 1st of every month at 09:00' },
];

/** `2026-08-04T09:30` — the shape `<input type="datetime-local">` speaks. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** A fire time, written in the routine's own zone rather than the reader's. */
function formatInZone(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/**
 * How a routine starts: manual, one-shot, or cron — plus a plain-language
 * preview of the next fire times.
 *
 * The preview is not decoration. Nobody can read `*​/15 * * * *` in a timezone
 * and be sure; without it an author would only find out their schedule was
 * wrong the morning it did not run. It is computed by the server (same code the
 * scheduler runs), so what is shown is literally what will happen.
 */
export function TriggerEditor({ value, onChange }: {
  value: RoutineTrigger;
  onChange: (t: RoutineTrigger) => void;
}) {
  const [preview, setPreview] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const timezone = value.kind === 'manual' ? browserTimezone() : value.timezone;

  useEffect(() => {
    if (value.kind === 'manual') {
      setPreview([]);
      setPreviewError(null);
      return;
    }
    // Debounced: the cron field is typed character by character and every
    // intermediate state is invalid, so firing per keystroke would paint a red
    // error under the author's fingers.
    let cancelled = false;
    setPreviewing(true);
    const t = setTimeout(() => {
      api.previewRoutineTrigger(value, 3)
        .then((next) => {
          if (cancelled) return;
          setPreview(next);
          setPreviewError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setPreview([]);
          setPreviewError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => { if (!cancelled) setPreviewing(false); });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [value]);

  const onKindChange = (kind: RoutineTriggerKind) => {
    if (kind === 'manual') return onChange({ kind: 'manual' });
    const tz = value.kind === 'manual' ? browserTimezone() : value.timezone;
    if (kind === 'once') {
      const inAnHour = new Date(Date.now() + 3600_000);
      onChange({
        kind: 'once',
        runAt: value.kind === 'once' ? value.runAt : inAnHour.toISOString(),
        timezone: tz,
      });
      return;
    }
    onChange({ kind: 'cron', cron: value.kind === 'cron' ? value.cron : '0 9 * * *', timezone: tz });
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-overlay)] p-3">
      <Select
        label="Trigger"
        options={KIND_OPTIONS}
        value={value.kind}
        onChange={(e) => onKindChange(e.target.value as RoutineTriggerKind)}
      />

      {value.kind === 'once' && (
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Input
              label="Runs at"
              type="datetime-local"
              className="w-full"
              value={toDatetimeLocal(value.runAt)}
              onChange={(e) => onChange({ ...value, runAt: fromDatetimeLocal(e.target.value) })}
            />
          </div>
          <div className="min-w-0 flex-1">
            <TimezoneInput value={value.timezone} onChange={(tz) => onChange({ ...value, timezone: tz })} />
          </div>
        </div>
      )}

      {value.kind === 'cron' && (
        <div className="flex flex-col gap-2">
          <Select
            label="Preset"
            options={[
              ...(CRON_PRESETS.some((p) => p.value === value.cron) ? [] : [{ value: value.cron, label: 'Custom' }]),
              ...CRON_PRESETS,
            ]}
            value={value.cron}
            onChange={(e) => onChange({ ...value, cron: e.target.value })}
          />
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Input
                label="Cron expression"
                className="w-full font-mono"
                value={value.cron}
                onChange={(e) => onChange({ ...value, cron: e.target.value })}
                placeholder="minute hour day month weekday"
              />
            </div>
            <div className="min-w-0 flex-1">
              <TimezoneInput value={value.timezone} onChange={(tz) => onChange({ ...value, timezone: tz })} />
            </div>
          </div>
        </div>
      )}

      {value.kind === 'manual' ? (
        <p className="text-xs text-[var(--theme-text-muted)]">
          This routine only runs when someone hits Launch.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-[var(--theme-text-secondary)]">Next runs</div>
          {previewError && <p className={cn('text-xs', tintText('red'))}>{previewError}</p>}
          {!previewError && previewing && preview.length === 0 && (
            <p className="text-xs text-[var(--theme-text-muted)]">Computing…</p>
          )}
          {!previewError && !previewing && preview.length === 0 && (
            <p className="text-xs text-[var(--theme-text-muted)]">
              {value.kind === 'once'
                ? 'That moment is already past — the routine will fire once, immediately.'
                : 'No upcoming run.'}
            </p>
          )}
          {preview.map((iso) => (
            <p key={iso} className="text-xs text-[var(--theme-text-primary)]">
              {formatInZone(iso, timezone)}{' '}
              <span className="text-[var(--theme-text-muted)]">({timezone})</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function TimezoneInput({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  return (
    <Input
      label="Timezone"
      className="w-full"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Europe/Paris"
    />
  );
}
