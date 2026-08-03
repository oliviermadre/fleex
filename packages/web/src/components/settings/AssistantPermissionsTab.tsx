import { useEffect } from 'react';
import {
  useAssistantStore,
  toolLabel,
  CAP_PERSISTENT_ALLOWLIST,
} from '../../stores/assistantStore';
import { Button } from '../ui/Button';

/**
 * Permanent tool approvals granted from the assistant's confirmation gate.
 *
 * "Toujours autoriser « ticket create »" now holds across conversations and
 * companion restarts, so it needs somewhere to be audited and taken back — an
 * approval the user can't see or revoke is not consent.
 *
 * The canonical tool name is shown next to the human label on purpose: the
 * allowlist is keyed by the `fleex_*` name, and that key is what the user must
 * be able to verify.
 */
export function AssistantPermissionsTab() {
  const ensureConnected = useAssistantStore((s) => s.ensureConnected);
  const connected = useAssistantStore((s) => s.connected);
  const tools = useAssistantStore((s) => s.globalAllowlist);
  const supported = useAssistantStore((s) => s.capabilities.includes(CAP_PERSISTENT_ALLOWLIST));
  const revokeGlobalTool = useAssistantStore((s) => s.revokeGlobalTool);
  const clearGlobalAllowlist = useAssistantStore((s) => s.clearGlobalAllowlist);

  useEffect(() => {
    ensureConnected();
  }, [ensureConnected]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">Autorisations permanentes</h2>
        <p className="mt-1 text-xs text-[var(--theme-text-muted)]">
          Ces commandes s'exécutent sans confirmation dans toutes les conversations de l'assistant.
          Une conversation à laquelle une page web a été jointe redemande toujours confirmation.
        </p>
      </div>

      {!connected && (
        <p className="text-xs text-[var(--theme-text-muted)]">
          Companion injoignable — lance <code>fleex start</code>.
        </p>
      )}

      {connected && !supported && (
        <p className="text-xs text-[var(--theme-text-muted)]">
          Le companion en cours d'exécution est obsolète et ne gère pas les autorisations permanentes.
          Relance <code>fleex start</code> (ou <code>fleex companion stop</code>) pour le mettre à jour.
        </p>
      )}

      {connected && supported && tools.length === 0 && (
        <p className="text-xs text-[var(--theme-text-muted)]">Aucune autorisation permanente.</p>
      )}

      {connected && supported && tools.length > 0 && (
        <>
          <ul className="flex flex-col divide-y divide-[var(--theme-border-subtle)] rounded-lg border border-[var(--theme-border)]">
            {tools.map((name) => (
              <li key={name} className="flex items-center gap-3 px-3 py-2">
                <code className="shrink-0 font-mono text-[11px] text-[var(--theme-text-muted)]">{name}</code>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--theme-text-primary)]">
                  {toolLabel(name)}
                </span>
                <button
                  onClick={() => revokeGlobalTool(name)}
                  className="shrink-0 rounded-md border border-[var(--theme-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
                >
                  Révoquer
                </button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={clearGlobalAllowlist}>
              Tout révoquer
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
