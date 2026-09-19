/**
 * The composer's conversation execution bar: Mode (talk/plan/edit) pill, Model
 * override dropdown, Effort dropdown and Fast toggle. Purely presentational —
 * all state and persistence live in {@link useExecConfig}, so every composer
 * surface (ticket comments, mobile, the Work stream) renders the same bar.
 */
import type { ConversationMode, EffortLevel } from '@fleex/shared';
import { tint } from '../../lib/tints';
import { ModelSelect } from '../agents/ModelSelect';
import { InfoHint } from '../ui/InfoHint';
import type { ExecConfig } from '../../hooks/useExecConfig';

/** Per-mode color for the conversation execution-mode pill. */
const MODE_PILL_CLASS: Record<ConversationMode, string> = {
  talk: tint('teal'),
  plan: tint('purple'),
  edit: tint('green'),
};

export function ComposerExecBar({ exec }: { exec: ExecConfig }) {
  const {
    executionMode,
    modelOverride,
    effortOverride,
    fastMode,
    effortLevels,
    showEffort,
    showFast,
    effectiveEffort,
    patchExecConfig,
    cycleMode,
  } = exec;

  return (
    <>
      {/* Mode: single pill, cycles Talk→Plan→Edit on click (or Shift+Tab) */}
      <span className="flex items-center gap-1 text-[var(--theme-text-secondary)]">
        Mode :
        <InfoHint text="Le mode définit les droits de l'agent au prochain acknowledge : Talk = réponse sans outils, Plan = lecture seule, Edit = écriture (Write/Edit/Bash). Il appartient à la conversation et s'applique à la prochaine exécution, sans envoyer de message." />
      </span>
      <button
        type="button"
        onClick={cycleMode}
        title="Conversation mode — click or Shift+Tab to cycle (Ctrl+1/2/3 to set). Applies to the next agent acknowledge, sends no message."
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium transition-colors ${MODE_PILL_CLASS[executionMode]}`}
      >
        <span className="capitalize">{executionMode}</span>
        <span className="text-[10px] opacity-60">⇧⇥</span>
      </button>

      {/* Model override dropdown — default "Auto (persona)" */}
      <span className="ml-1 flex items-center gap-1 text-[var(--theme-text-secondary)]">
        Model :
        <InfoHint text="Le modèle utilisé pour la prochaine exécution de l'agent mentionné. Auto = chaque agent garde le modèle de sa config. Choisir un modèle ici est un override de conversation : il s'applique à la prochaine mention sans modifier la config de l'agent." />
      </span>
      <ModelSelect
        variant="inline"
        icon="🤖"
        value={modelOverride ?? ''}
        onChange={(v) => patchExecConfig({ modelOverride: v === '' ? null : v })}
        leadingOption={{ value: '', label: 'Auto (persona)' }}
        title="Model for the next agent run. Auto = inherit the agent's own model. An override applies to the next mention without changing the agent config."
        ariaLabel="Model override"
      />

      {/* Effort dropdown — shown only when the resolved model supports it */}
      {showEffort && (
        <label className="flex items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1 text-[var(--theme-text-secondary)]">
          <span className="opacity-60">◐</span>
          <select
            value={effectiveEffort}
            onChange={(e) => patchExecConfig({ effortOverride: e.target.value === '' ? null : (e.target.value as EffortLevel) })}
            title={
              effortOverride && effectiveEffort !== effortOverride
                ? `Reasoning effort for the next agent run. "${effortOverride}" isn't available on this model — it will run at "${effectiveEffort || 'default'}".`
                : 'Reasoning effort for the next agent run.'
            }
            className="cursor-pointer bg-transparent pr-1 text-xs text-[var(--theme-text-secondary)] focus:outline-none"
          >
            <option value="">Effort: default</option>
            {effortLevels.map((lvl) => (
              <option key={lvl} value={lvl}>Effort: {lvl}</option>
            ))}
          </select>
        </label>
      )}

      {/* Fast toggle — shown only when the resolved model supports it */}
      {showFast && (
        <button
          type="button"
          onClick={() => patchExecConfig({ fastMode: !fastMode })}
          title="Fast (low-latency) mode for the next agent run."
          className={`flex items-center gap-1 rounded-md border px-2 py-1 font-medium transition-colors ${
            fastMode
              ? tint('yellow')
              : 'border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)]'
          }`}
        >
          <span>⚡</span>
          <span>Fast</span>
        </button>
      )}
    </>
  );
}
