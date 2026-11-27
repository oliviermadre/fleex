/**
 * The `vide` state of an Assistant conversation: what it can now do, as
 * one-click prompts. Shared by the desktop panel and the mobile tab.
 */
export const ASSISTANT_INTRO =
  "L'assistant a les outils de tes agents : toute la CLI fleex, des scripts qu'il écrit et lance, tes fichiers, tes MCP et tes skills.";

export const ASSISTANT_SUGGESTIONS = [
  'Écris un script qui exporte en CSV les tickets bloqués depuis plus de 5 jours et lance-le',
  'Lis le README de ~/projects/fleex et résume-le',
  "Cherche dans Notion la spec de l'onboarding",
] as const;

/** Clickable when a conversation is open (`onPick` sends the prompt); a plain list otherwise. */
export function AssistantSuggestions({ onPick, className }: { onPick?: (text: string) => void; className?: string }) {
  return (
    <ul className={className ?? 'flex max-w-md flex-col gap-1.5 text-xs text-[var(--theme-text-faint)]'}>
      {ASSISTANT_SUGGESTIONS.map((s) => (
        <li key={s}>
          {onPick ? (
            <button
              type="button"
              onClick={() => onPick(s)}
              className="w-full rounded-md border border-[var(--theme-border)] px-3 py-1.5 text-left text-[var(--theme-text-muted)] transition-colors hover:border-[var(--theme-accent)] hover:text-[var(--theme-text-primary)]"
            >
              {s}
            </button>
          ) : (
            <>«&nbsp;{s}&nbsp;»</>
          )}
        </li>
      ))}
    </ul>
  );
}
