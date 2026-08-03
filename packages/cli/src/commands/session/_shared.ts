import { apiBase, apiGet } from '../../core/api.ts';
import { die, err, c } from '../../core/colors.ts';
import { matchById } from '../../core/match.ts';

export interface Session {
  id: string;
  type: string;
  status: string;
  cwd: string;
  displayName: string;
  worktreeBranch?: string | null;
  repositoryOrg?: string | null;
  repositoryName?: string | null;
  createdAt?: string;
}

export const VALID_SESSION_TYPES = ['shell', 'claude'] as const;

export function assertValidSessionType(t: string): void {
  if (!VALID_SESSION_TYPES.includes(t as (typeof VALID_SESSION_TYPES)[number])) {
    die(`Invalid session type: ${t} (valid: ${VALID_SESSION_TYPES.join(', ')})`);
  }
}

/**
 * Resolve a session reference (full UUID or unique 8-char prefix, with an
 * optional leading `#`) to its record, falling back to a case-insensitive exact
 * display-name match. Ambiguous references are surfaced rather than guessed.
 */
export async function resolveSession(input: string): Promise<Session> {
  const sessions = await apiGet<Session[]>(`${apiBase()}/api/sessions`);

  const byId = matchById(sessions, input);
  if (byId.kind === 'found') return byId.item;
  if (byId.kind === 'ambiguous') {
    err(`"${input}" matches multiple sessions — use a longer prefix or the full UUID:`);
    for (const s of byId.matches) process.stderr.write(`  ${s.id.slice(0, 8)}  ${s.displayName}\n`);
    process.exit(1);
  }

  const lower = input.trim().toLowerCase();
  if (lower) {
    const byName = sessions.filter((s) => s.displayName?.toLowerCase() === lower);
    if (byName.length === 1) return byName[0]!;
    if (byName.length > 1) {
      err(`"${input}" matches multiple sessions by name — use the id instead:`);
      for (const s of byName) process.stderr.write(`  ${s.id.slice(0, 8)}  ${s.displayName}\n`);
      process.exit(1);
    }
  }

  die(`No session matches "${input}". List sessions with ${c.cyan('fleex session list')}.`);
}
