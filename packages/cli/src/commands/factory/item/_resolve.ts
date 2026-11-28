import { die, err } from '../../../core/colors.ts';
import { apiCall, apiGet } from '../../../core/api.ts';
import { matchById } from '../../../core/match.ts';
import { enc, fetchTokens, fx } from '../_shared.ts';
import type { ItemRow } from './_shared.ts';

interface ArchivedItem { itemId: string; title: string; source: string }

/**
 * An item from what was typed, on the floor or archived: a full id is asked for as it is; the start of one is looked
 * for on the floor first, then among the items archived over the last 90 days (as far back as the archive is listed).
 */
export async function resolveItemId(ref: string): Promise<string> {
  const needle = ref.trim().replace(/^#/, '');
  if (!needle) die('An item id is required.');
  if (needle.includes('-') && needle.length >= 36) return needle;
  const onFloor = (await fetchTokens()).filter((t) => t.kind === 'item');
  const archived = (await apiGet<{ items: ArchivedItem[] }>(fx('/items/archived?days=90'))).items.map((i) => ({ id: i.itemId, title: i.title, source: i.source }));
  const found = matchById([...onFloor.map((t) => ({ id: t.id, title: t.title, source: t.source ?? '' })), ...archived], needle);
  if (found.kind === 'found') return found.item.id;
  if (found.kind === 'none') die(`No item matches "${ref}". Run \`fleex factory item list\`, or \`fleex factory item archived\` for those that left.`);
  err(`"${ref}" matches several items — use a longer prefix or the full id:`);
  for (const i of found.matches) process.stderr.write(`  ${i.id}  ${i.source}  ${i.title}\n`);
  process.exit(1);
}

export async function fetchItem(ref: string): Promise<ItemRow> {
  const id = await resolveItemId(ref);
  try { return await apiCall<ItemRow>('GET', fx(`/items/${enc(id)}`)); } catch (e) { die(`No item matches "${ref}" (${e instanceof Error ? e.message : String(e)})`); }
}
