import { die, err, c } from '../../core/colors.ts';
import { apiBase, apiGet } from '../../core/api.ts';
import { matchById } from '../../core/match.ts';

export interface Token {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt?: string | null;
  createdAt?: string;
}

/**
 * Resolve an agent-token reference (full UUID or unique 8-char prefix, with an
 * optional leading `#`) to its record, falling back to a case-insensitive exact
 * name match. Ambiguous references are surfaced rather than guessed — revoking
 * the wrong token would silently break a live integration.
 */
export async function resolveToken(input: string): Promise<Token> {
  const tokens = await apiGet<Token[]>(`${apiBase()}/api/agent-tokens`);

  const byId = matchById(tokens, input);
  if (byId.kind === 'found') return byId.item;
  if (byId.kind === 'ambiguous') {
    err(`"${input}" matches multiple tokens — use a longer prefix or the full UUID:`);
    for (const t of byId.matches) process.stderr.write(`  ${t.id.slice(0, 8)}  ${t.name}\n`);
    process.exit(1);
  }

  const lower = input.trim().toLowerCase();
  if (lower) {
    const byName = tokens.filter((t) => t.name?.toLowerCase() === lower);
    if (byName.length === 1) return byName[0]!;
    if (byName.length > 1) {
      err(`"${input}" matches multiple tokens by name — use the id instead:`);
      for (const t of byName) process.stderr.write(`  ${t.id.slice(0, 8)}  ${t.name}\n`);
      process.exit(1);
    }
  }

  die(`No token matches "${input}". List tokens with ${c.cyan('fleex token list')}.`);
}
