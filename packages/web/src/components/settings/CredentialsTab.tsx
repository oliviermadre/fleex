/**
 * Settings → Credentials tab.
 *
 * Lets the user configure ANTHROPIC_API_KEY + Supabase storage driver
 * without ever opening a terminal. Reads/writes ~/.fleex/.env through
 * the /api/credentials endpoint.
 *
 * Display rules:
 *   - secrets are returned masked from the server; we re-mask on focus loss
 *     so the user never sees their key after navigation away.
 *   - empty string in a save payload deletes the key.
 *   - changing FLEEX_STORAGE_DRIVER prompts the user to restart Fleex.
 */
import { useEffect, useState, useCallback } from 'react';
import { API_URL } from '../../lib/constants';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

type ManagedKey =
  | 'ANTHROPIC_API_KEY'
  | 'FLEEX_STORAGE_DRIVER'
  | 'FLEEX_SUPABASE_URL'
  | 'FLEEX_SUPABASE_KEY'
  | 'FLEEX_SUPABASE_DB_URL';

interface CredentialsState {
  path: string;
  isPackaged: boolean;
  credentials: Record<ManagedKey, { value: string; isSet: boolean }>;
}

const SECRET_KEYS: ManagedKey[] = [
  'ANTHROPIC_API_KEY',
  'FLEEX_SUPABASE_KEY',
  'FLEEX_SUPABASE_DB_URL',
];

export function CredentialsTab() {
  const [state, setState] = useState<CredentialsState | null>(null);
  const [edits, setEdits] = useState<Partial<Record<ManagedKey, string>>>({});
  const [revealed, setRevealed] = useState<Partial<Record<ManagedKey, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/credentials`);
    if (!res.ok) {
      setStatusMsg('Failed to load credentials');
      return;
    }
    const data = (await res.json()) as CredentialsState;
    setState(data);
    setEdits({});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const driver = edits['FLEEX_STORAGE_DRIVER'] ?? state?.credentials?.FLEEX_STORAGE_DRIVER?.value ?? '';

  function setField(key: ManagedKey, value: string) {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/credentials`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(edits),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatusMsg(`Save failed: ${body.error ?? res.status}`);
        return;
      }
      const result = (await res.json()) as { ok: boolean; restartRequired: boolean };
      setStatusMsg(
        result.restartRequired
          ? 'Saved. Restart Fleex to switch storage driver.'
          : 'Saved.',
      );
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (!state) {
    return (
      <div className="text-sm text-[var(--theme-text-muted)]">Loading credentials…</div>
    );
  }

  // For secret fields: display the masked server value unless the user is
  // actively editing or has clicked Reveal.
  function fieldValue(key: ManagedKey): string {
    if (key in edits) return edits[key] as string;
    if (SECRET_KEYS.includes(key) && !revealed[key]) {
      return state!.credentials[key].value; // masked from server
    }
    return state!.credentials[key].value;
  }

  function fieldDirty(key: ManagedKey): boolean {
    return key in edits;
  }

  function renderSecretField(
    key: ManagedKey,
    label: string,
    help: string,
    placeholder = '',
  ) {
    const showRevealed = revealed[key] || fieldDirty(key);
    return (
      <div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Input
              id={key}
              label={label}
              type={showRevealed ? 'text' : 'password'}
              placeholder={placeholder}
              value={fieldValue(key)}
              onChange={(e) => setField(key, e.target.value)}
            />
          </div>
          {!fieldDirty(key) && state!.credentials[key].isSet && (
            <button
              className="mt-5 self-end text-xs text-[var(--theme-text-muted)] underline hover:text-[var(--theme-text-secondary)]"
              type="button"
              onClick={() => setRevealed((prev) => ({ ...prev, [key]: !prev[key] }))}
            >
              {revealed[key] ? 'hide' : 'reveal'}
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-[var(--theme-text-muted)]">{help}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2 text-xs text-[var(--theme-text-muted)]">
        Stored locally in{' '}
        <code className="rounded bg-[var(--theme-bg-overlay)] px-1 py-0.5 text-[var(--theme-text-secondary)]">
          {state.path}
        </code>{' '}
        with mode 600. These values never leave your machine.
      </div>

      {renderSecretField(
        'ANTHROPIC_API_KEY',
        'Anthropic API Key',
        'Used by the Claude SDK. Get one at console.anthropic.com.',
        'sk-ant-...',
      )}

      <div className="mt-4 border-t border-[var(--theme-border)] pt-4">
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Storage driver
        </label>
        <select
          value={driver}
          onChange={(e) => setField('FLEEX_STORAGE_DRIVER', e.target.value)}
          className="w-full rounded border border-[var(--theme-border-input)] bg-[var(--theme-bg-input)] px-3 py-2 text-sm text-[var(--theme-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
        >
          <option value="">(default — sqlite)</option>
          <option value="sqlite">SQLite (local, zero-config)</option>
          <option value="json">JSON (local file)</option>
          <option value="supabase">Supabase (cloud-synced)</option>
          <option value="pgsql">PostgreSQL (self-hosted)</option>
        </select>
        <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
          Restart Fleex after changing. SQLite is the default for the DMG bundle.
        </p>
      </div>

      {(driver === 'supabase' || driver === '') && state.credentials.FLEEX_SUPABASE_URL.isSet && (
        <div className="rounded-md border border-[var(--theme-border)] px-3 py-3">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Supabase (only used when driver = supabase)
          </div>
          <div className="flex flex-col gap-3">
            <Input
              id="FLEEX_SUPABASE_URL"
              label="Supabase URL"
              placeholder="https://xxxxx.supabase.co"
              value={fieldValue('FLEEX_SUPABASE_URL')}
              onChange={(e) => setField('FLEEX_SUPABASE_URL', e.target.value)}
            />
            {renderSecretField(
              'FLEEX_SUPABASE_KEY',
              'Supabase Anon Key',
              'Public key from your Supabase project settings.',
              'sb_publishable_...',
            )}
            {renderSecretField(
              'FLEEX_SUPABASE_DB_URL',
              'Supabase DB URL',
              'PostgreSQL connection string for migrations.',
              'postgresql://...',
            )}
          </div>
        </div>
      )}
      {driver === 'supabase' && !state.credentials.FLEEX_SUPABASE_URL.isSet && (
        <div className="rounded-md border border-[var(--theme-border)] px-3 py-3">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Supabase configuration
          </div>
          <div className="flex flex-col gap-3">
            <Input
              id="FLEEX_SUPABASE_URL"
              label="Supabase URL"
              placeholder="https://xxxxx.supabase.co"
              value={fieldValue('FLEEX_SUPABASE_URL')}
              onChange={(e) => setField('FLEEX_SUPABASE_URL', e.target.value)}
            />
            {renderSecretField('FLEEX_SUPABASE_KEY', 'Supabase Anon Key', 'Public key.', 'sb_publishable_...')}
            {renderSecretField('FLEEX_SUPABASE_DB_URL', 'Supabase DB URL', 'PostgreSQL connection string for migrations.', 'postgresql://...')}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="primary"
          onClick={save}
          disabled={saving || Object.keys(edits).length === 0}
        >
          {saving ? 'Saving…' : 'Save credentials'}
        </Button>
        {statusMsg && (
          <span className="text-xs text-[var(--theme-text-secondary)]">{statusMsg}</span>
        )}
      </div>
    </div>
  );
}
