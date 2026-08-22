# Références de notes `@scratchpad:` — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la syntaxe `[[…]]` des notes par une primitive `@scratchpad:` alignée sur la grammaire `@primitive:value` existante, et brancher l'autocomplétion des mentions sur l'éditeur de notes pour que le vocabulaire soit enfin découvrable.

**Architecture:** Le parseur partagé (`packages/shared`) devient la source unique de la syntaxe `@scratchpad:`, consommée par le préprocesseur Markdown du web et par le scan de backlinks du serveur. L'autocomplétion, aujourd'hui enfermée dans `TicketComments.tsx`, est extraite en un hook agnostique dont la liste d'options est un paramètre. La navigation cesse de dépendre du moteur sémantique ; seul « Related », qui interroge l'index vectoriel, reste derrière un drapeau renommé `relatedNotes`.

**Tech Stack:** TypeScript, React 19, react-markdown, Vitest, Fastify, monorepo Bun workspaces.

**Spec:** `docs/superpowers/specs/2026-08-22-note-references-design.md`

## Global Constraints

- **Langue du code et de l'UI** : anglais. Commentaires de code en anglais. Ce plan et la spec sont en français ; le code produit ne l'est pas.
- **`packages/shared` n'a pas de script de test.** Les tests du parseur partagé vivent dans `packages/server/tests/unit/`, comme l'actuel `wiki-links.test.ts`. Commande : `bun run --filter '@fleex/server' test`.
- **Tests web** : `bun run --filter '@fleex/web' test -- --run <motif>`.
- **Tests serveur** : `bun run --filter '@fleex/server' test -- --run <motif>`.
- **Typecheck** : `bun run --filter '@fleex/<pkg>' build` (c'est `tsc` pour `shared`, `server`, et `tsc && vite build` pour `web`).
- **Clé de la note globale** : `__global__`. Jamais réécrite en dur ailleurs qu'à l'endroit qui l'exporte.
- **Ne jamais modifier une migration déjà commitée** (`CLAUDE.md`). Ce chantier n'en crée aucune : PR #274 est ouverte, le drapeau `wikiLinks` n'a jamais atteint `main`, donc le renommage ne demande aucune normalisation de config.
- **Commits fréquents**, un par tâche minimum, message en anglais avec préfixe conventionnel.

---

## Structure des fichiers

**Créés**
- `packages/shared/src/note-refs.ts` — la syntaxe `@scratchpad:` : parse, normalisation de clé, collecte pour backlinks. Unique source de vérité.
- `packages/server/tests/unit/note-refs.test.ts` — tests du parseur partagé.
- `packages/web/src/components/markdown/NoteRefChip.tsx` — la puce de navigation vers une note.
- `packages/web/src/components/markdown/MentionMenu.tsx` — le menu déroulant + le type `MentionOption`, extraits de `TicketComments`.
- `packages/web/src/components/markdown/useMentionAutocomplete.ts` — l'état, le déclencheur, le clavier et l'insertion, agnostiques des primitives.
- `packages/web/src/components/markdown/useMentionAutocomplete.test.ts` — tests du hook.
- `packages/web/src/components/markdown/NoteRefChip.test.tsx` — rendu et navigation de la puce.

**Modifiés**
- `packages/shared/src/index.ts:244-245` — ré-exports.
- `packages/web/src/components/markdown/mentions.ts` — la primitive `@scratchpad:` dans les deux préprocesseurs ; `preprocessTicketMentions` → `preprocessReferences`.
- `packages/web/src/components/scratchpad/MarkdownRenderer.tsx:186-205,255-258` — dégatage et nouvelle branche d'href.
- `packages/web/src/components/scratchpad/NoteLinksPanel.tsx:19-20,38-40` — perte du sélecteur `enabled`.
- `packages/web/src/components/scratchpad/ScratchpadMainView.tsx` — câblage de l'autocomplétion.
- `packages/web/src/components/tickets/TicketComments.tsx:470-525,563-566,737-748,1245-1290,1652-1660` — passage au hook extrait.
- `packages/web/src/components/ui/MentionTypeBadge.tsx:9,16-23` — type `scratchpad`.
- `packages/server/src/infrastructure/http/scratchpad.routes.ts:74-104` — gating et scan.
- `packages/server/src/application/ports/config.port.ts:110,136` — renommage du drapeau.
- `packages/web/src/stores/settingsStore.ts:79` · `packages/web/src/components/settings/MemoryTab.tsx:17-20,84-88` · `packages/cli/src/commands/memory/_shared.ts:61-75` — renommage.
- `README.md:138,162` — documentation.

**Supprimés**
- `packages/shared/src/wiki-links.ts`
- `packages/web/src/components/markdown/wiki.ts` · `wiki.test.ts` · `WikiLinkChip.tsx`
- `packages/web/src/components/scratchpad/MarkdownRenderer.wiki-link.test.tsx`
- `packages/server/tests/unit/wiki-links.test.ts`

---

### Task 1: La syntaxe partagée

**Files:**
- Create: `packages/shared/src/note-refs.ts`
- Create: `packages/server/tests/unit/note-refs.test.ts`
- Modify: `packages/shared/src/index.ts:244-245`
- Delete: `packages/shared/src/wiki-links.ts`, `packages/server/tests/unit/wiki-links.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `GLOBAL_NOTE_KEY: '__global__'`
  - `interface NoteRef { raw: string; key: string; start: number; end: number }`
  - `parseNoteRefs(text: string): NoteRef[]`
  - `normaliseNoteKey(value: string): string | null`
  - `collectNoteRefs(text: string): string[]`
  - `referencesNote(text: string, key: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/unit/note-refs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseNoteRefs, normaliseNoteKey, collectNoteRefs, referencesNote, GLOBAL_NOTE_KEY } from '@fleex/shared';

describe('parseNoteRefs', () => {
  it('finds a repo note reference', () => {
    const [ref] = parseNoteRefs('conventions live in @scratchpad:acme/app today');
    expect(ref).toMatchObject({ raw: '@scratchpad:acme/app', key: 'acme/app' });
  });

  it('resolves the global note to its storage key', () => {
    expect(parseNoteRefs('see @scratchpad:global')[0]?.key).toBe(GLOBAL_NOTE_KEY);
  });

  it('lowercases a repo key so references match however they were typed', () => {
    expect(parseNoteRefs('@scratchpad:Acme/App')[0]?.key).toBe('acme/app');
    expect(parseNoteRefs('@scratchpad:GLOBAL')[0]?.key).toBe(GLOBAL_NOTE_KEY);
  });

  it('reports offsets so a renderer can splice the source', () => {
    const text = 'before @scratchpad:acme/app after';
    const [ref] = parseNoteRefs(text);
    expect(text.slice(ref!.start, ref!.end)).toBe('@scratchpad:acme/app');
  });

  it('stops before trailing punctuation', () => {
    // A reference at the end of a sentence must not swallow the period, or the
    // key would never match the one the list endpoint reports.
    const [ref] = parseNoteRefs('written up in @scratchpad:acme/app.');
    expect(ref?.key).toBe('acme/app');
    expect(ref?.raw).toBe('@scratchpad:acme/app');
  });

  it('declines a bare word that is neither global nor owner/name', () => {
    // Fleex notes are the global one plus one per repo; there is no free-form
    // namespace, so an arbitrary word points at nothing.
    expect(parseNoteRefs('@scratchpad:my-idea')).toEqual([]);
  });

  it('requires the colon, so a longer primitive name does not match', () => {
    expect(parseNoteRefs('@scratchpads:global names nothing')).toEqual([]);
    expect(parseNoteRefs('@scratchpadding/thing')).toEqual([]);
  });

  it('matches a reference glued to a preceding word', () => {
    // The parser is deliberately context-free: whether an `@` opens a mention is
    // the editor's business, and the backlink scan must see every reference a
    // document contains however it was punctuated.
    expect(parseNoteRefs('(see@scratchpad:global)')[0]?.key).toBe(GLOBAL_NOTE_KEY);
  });

  it('finds several references in one document', () => {
    expect(collectNoteRefs('@scratchpad:global and @scratchpad:acme/app')).toEqual([GLOBAL_NOTE_KEY, 'acme/app']);
  });
});

describe('collectNoteRefs', () => {
  it('deduplicates repeated references', () => {
    expect(collectNoteRefs('@scratchpad:acme/app twice @scratchpad:Acme/App')).toEqual(['acme/app']);
  });

  it('returns nothing for prose without references', () => {
    expect(collectNoteRefs('plain prose about scratchpads')).toEqual([]);
  });
});

describe('referencesNote', () => {
  it('is true when the document points at the key', () => {
    expect(referencesNote('see @scratchpad:global', GLOBAL_NOTE_KEY)).toBe(true);
  });

  it('does not confuse two neighbouring keys', () => {
    expect(referencesNote('@scratchpad:acme/app', 'acme/apparel')).toBe(false);
  });
});

describe('normaliseNoteKey', () => {
  it('maps every spelling of global to the storage key', () => {
    expect(normaliseNoteKey('global')).toBe(GLOBAL_NOTE_KEY);
    expect(normaliseNoteKey('Global')).toBe(GLOBAL_NOTE_KEY);
  });

  it('returns null for a value that names no note', () => {
    expect(normaliseNoteKey('an idea')).toBeNull();
    expect(normaliseNoteKey('acme/app/extra')).toBeNull();
  });
});
```

Two of these cases pin deliberate choices rather than incidental behaviour. The colon is load-bearing: `@scratchpads:global` and `@scratchpadding/thing` both fail to match because the pattern requires the literal `@scratchpad:`, so a near-miss stays plain text instead of becoming a chip to nowhere. And the parser is context-free by design — it does not care what precedes the `@`, because deciding whether an `@` opens a mention belongs to the editor, while the backlink scan must see every reference a stored document contains.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@fleex/server' test -- --run note-refs`
Expected: FAIL — `No test files found` or `parseNoteRefs is not exported from @fleex/shared`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/note-refs.ts`:

```ts
/**
 * `@scratchpad:` references in markdown.
 *
 * Lives in `shared` because both ends need the same parse: the web renders the
 * references and the server resolves them into backlinks. Two implementations
 * would drift, and a reference that renders but does not resolve is worse than
 * no reference at all.
 *
 * Fleex notes are a closed set — the global note plus one per repository — so a
 * value that is neither `global` nor `owner/name` names nothing and is declined
 * rather than guessed at.
 */

/** Storage key of the global note. */
export const GLOBAL_NOTE_KEY = '__global__';

export interface NoteRef {
  /** The matched text, e.g. `@scratchpad:acme/app`. */
  raw: string;
  /** Storage key: `__global__`, or a lowercased `owner/name`. */
  key: string;
  /** Character offsets in the source text, so a renderer can splice. */
  start: number;
  end: number;
}

/**
 * Matches `@scratchpad:<value>` where value is one or two `/`-joined segments.
 *
 * Each segment must END on a word character: without that, the greedy `[\w.-]+`
 * eats the period closing a sentence, producing a key no note ever matches.
 * Classification of the captured value happens in `normaliseNoteKey`, not here —
 * a regex that also decided what is a valid note would be unreadable.
 */
const NOTE_REF_RE = /@scratchpad:([\w.-]*\w(?:\/[\w.-]*\w)?)/g;

/** Valid repo key shape, once lowercased. */
const REPO_KEY_RE = /^[\w.-]+\/[\w.-]+$/;

/**
 * Resolve a captured reference value to a storage key, or `null` if it names no
 * note. `global` in any casing is the global note; `owner/name` is a repository
 * note, lowercased so a reference matches however it was typed.
 */
export function normaliseNoteKey(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (v === 'global') return GLOBAL_NOTE_KEY;
  return REPO_KEY_RE.test(v) ? v : null;
}

/** Every note reference in a piece of markdown, in source order. */
export function parseNoteRefs(text: string): NoteRef[] {
  const refs: NoteRef[] = [];
  // A fresh regex per call: a shared global regex carries `lastIndex` between
  // calls and would skip matches on the second document it saw.
  const re = new RegExp(NOTE_REF_RE.source, 'g');

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const key = normaliseNoteKey(match[1]!);
    if (key === null) continue;
    refs.push({ raw: match[0], key, start: match.index, end: match.index + match[0].length });
  }
  return refs;
}

/** Distinct note keys a document references, for backlink indexing. */
export function collectNoteRefs(text: string): string[] {
  return [...new Set(parseNoteRefs(text).map((ref) => ref.key))];
}

/**
 * Whether `text` references the note `key`.
 *
 * Backlinks are computed by scanning candidate documents, which is the right
 * trade at this scale: a handful of notes is cheaper to scan than a link table
 * is to keep consistent through every edit.
 */
export function referencesNote(text: string, key: string): boolean {
  return collectNoteRefs(text).includes(key);
}
```

- [ ] **Step 4: Swap the exports**

In `packages/shared/src/index.ts`, replace lines 244-245:

```ts
export type { NoteRef } from './note-refs.js';
export { GLOBAL_NOTE_KEY, parseNoteRefs, normaliseNoteKey, collectNoteRefs, referencesNote } from './note-refs.js';
```

- [ ] **Step 5: Delete the old parser and its test**

```bash
git rm packages/shared/src/wiki-links.ts packages/server/tests/unit/wiki-links.test.ts
```

The build will now fail at every remaining consumer. That is expected and tasks 2-5 close them; do NOT patch them here.

- [ ] **Step 6: Run the new test to verify it passes**

Run: `bun run --filter '@fleex/server' test -- --run note-refs`
Expected: PASS, 15 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/note-refs.ts packages/shared/src/index.ts packages/server/tests/unit/note-refs.test.ts
git commit -m "feat(shared): parse @scratchpad: note references"
```

---

### Task 2: La primitive dans les préprocesseurs Markdown

**Files:**
- Modify: `packages/web/src/components/markdown/mentions.ts`
- Modify: `packages/web/src/components/markdown/mentions.test.ts`

**Interfaces:**
- Consumes: `normaliseNoteKey` from `@fleex/shared` (Task 1).
- Produces:
  - `SCRATCHPAD_REF_HREF_PREFIX = '#fleex-scratchpad:'`
  - `preprocessReferences(body: string): string` — renamed from `preprocessTicketMentions`, now encoding both `@ticket:` and `@scratchpad:`.
  - `preprocessMentions(body: string): string` — unchanged name, gains `@scratchpad:`.

- [ ] **Step 1: Write the failing test**

Append to `packages/web/src/components/markdown/mentions.test.ts`:

```ts
import { preprocessReferences, preprocessMentions, SCRATCHPAD_REF_HREF_PREFIX } from './mentions';

describe('preprocessReferences — note references', () => {
  it('encodes a repo note', () => {
    expect(preprocessReferences('see @scratchpad:acme/app'))
      .toBe('see [@scratchpad:acme/app](#fleex-scratchpad:acme%2Fapp)');
  });

  it('encodes the global note to its storage key', () => {
    expect(preprocessReferences('see @scratchpad:global'))
      .toBe('see [@scratchpad:global](#fleex-scratchpad:__global__)');
  });

  it('lowercases the key in the href but keeps the typed label', () => {
    expect(preprocessReferences('@scratchpad:Acme/App'))
      .toBe('[@scratchpad:Acme/App](#fleex-scratchpad:acme%2Fapp)');
  });

  it('leaves a value that names no note verbatim', () => {
    expect(preprocessReferences('@scratchpad:my-idea')).toBe('@scratchpad:my-idea');
  });

  it('leaves a reference inside an inline code span alone', () => {
    expect(preprocessReferences('write `@scratchpad:acme/app`')).toBe('write `@scratchpad:acme/app`');
  });

  it('leaves a struck reference as strikethrough text', () => {
    expect(preprocessReferences('~~@scratchpad:acme/app~~')).toBe('~~@scratchpad:acme/app~~');
  });

  it('still encodes ticket mentions', () => {
    expect(preprocessReferences('@ticket:378')).toBe('[@ticket:378](#fleex-ticket:378)');
  });

  it('encodes both kinds in one document', () => {
    expect(preprocessReferences('@ticket:7 and @scratchpad:global'))
      .toBe('[@ticket:7](#fleex-ticket:7) and [@scratchpad:global](#fleex-scratchpad:__global__)');
  });

  it('exposes the href prefix it encodes to', () => {
    expect(SCRATCHPAD_REF_HREF_PREFIX).toBe('#fleex-scratchpad:');
  });
});

describe('preprocessMentions — note references', () => {
  it('encodes a note reference without being eaten by the human fallback', () => {
    // `@[a-zA-Z0-9_-]+` would otherwise capture `@scratchpad` and leave
    // `:acme/app` dangling — the same trap the @ticket: ordering guards against.
    expect(preprocessMentions('see @scratchpad:acme/app'))
      .toBe('see [@scratchpad:acme/app](#fleex-scratchpad:acme%2Fapp)');
  });

  it('encodes a struck note reference the way every other struck mention is encoded', () => {
    expect(preprocessMentions('~~@scratchpad:global~~'))
      .toBe('[@scratchpad:global](#fleex-struck:scratchpad:global)');
  });

  // No regression check for @agent: here — mentions.test.ts already pins it twice, and the
  // href keeps the `agent:` prefix (`#fleex-agent:agent:catalyst`) because the branch strips
  // only the `@`. Re-asserting it from memory is how a wrong expectation gets written.

});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@fleex/web' test -- --run mentions`
Expected: FAIL — `preprocessReferences is not exported`.

- [ ] **Step 3: Add the primitive to `mentions.ts`**

At the top of `packages/web/src/components/markdown/mentions.ts`, after the `TICKET_MENTION_HREF_PREFIX` export:

```ts
import { normaliseNoteKey } from '@fleex/shared';

/** Href prefix a note reference is encoded to (`#fleex-scratchpad:<key>`). */
export const SCRATCHPAD_REF_HREF_PREFIX = '#fleex-scratchpad:';

// One or two `/`-joined segments, each ending on a word character so a reference
// closing a sentence does not swallow the period. Kept as a single fragment so
// both regexes below stay in sync, exactly like TICKET_ID.
const NOTE_REF = String.raw`[\w.-]*\w(?:\/[\w.-]*\w)?`;

/**
 * Encode a captured `@scratchpad:<value>` as a Markdown link, or return it
 * verbatim when the value names no note.
 *
 * The key is URI-encoded: a repo key contains a slash, which would end the link
 * destination early and produce a broken link.
 */
function encodeNoteRef(active: string): string {
  const key = normaliseNoteKey(active.slice('@scratchpad:'.length));
  if (key === null) return active;
  return `[${active}](${SCRATCHPAD_REF_HREF_PREFIX}${encodeURIComponent(key)})`;
}
```

- [ ] **Step 4: Extend the generic-surface processor**

Replace the `TICKET_ONLY_MENTION` regex and `preprocessTicketMentions` (lines 34-52) with:

```ts
/**
 * Encode ticket and note references, preserving code spans and leaving struck
 * references verbatim (remark-gfm renders `~~…~~` as strikethrough — no chip).
 * Every other `@mention` is left untouched: the generic surfaces have no chip
 * for an agent or a skill, and encoding one would render a broken link.
 */
const REFERENCE_MENTION = new RegExp(
  // 1: code span · 2: struck ticket · 3: struck note · 4: active ticket · 5: active note
  '(```[\\s\\S]*?```|`[^`]*`)' +
    `|(~~@ticket:(?:${TICKET_ID})~~)` +
    `|(~~@scratchpad:(?:${NOTE_REF})~~)` +
    `|(@ticket:(?:${TICKET_ID}))` +
    `|(@scratchpad:(?:${NOTE_REF}))`,
  'g',
);

export function preprocessReferences(body: string): string {
  return body.replace(
    REFERENCE_MENTION,
    (match, codeSpan, struckTicket, struckNote, activeTicket, activeNote) => {
      if (codeSpan !== undefined) return codeSpan;
      if (struckTicket !== undefined) return struckTicket;
      if (struckNote !== undefined) return struckNote;
      if (activeTicket !== undefined)
        return `[${activeTicket}](${TICKET_MENTION_HREF_PREFIX}${activeTicket.slice('@ticket:'.length)})`;
      if (activeNote !== undefined) return encodeNoteRef(activeNote);
      return match;
    },
  );
}
```

Update the file's header comment: the second entry point is now `preprocessReferences`, and it encodes ticket **and note** references.

- [ ] **Step 5: Extend the comment processor**

In `ALL_MENTIONS`, add a struck alternative after the struck ticket one and an active alternative after the active ticket one — both **before** the human fallback:

```ts
    `|~~(@ticket:(?:${TICKET_ID}))~~` +
    `|~~(@scratchpad:(?:${NOTE_REF}))~~` +
    '|~~(@[a-zA-Z0-9_-]+)~~' +
```

```ts
    `|(@ticket:(?:${TICKET_ID}))` +
    `|(@scratchpad:(?:${NOTE_REF}))` +
    '|(@[a-zA-Z0-9_-]+)',
```

Then add the two parameters to `preprocessMentions`'s callback, in the same positions, and handle them:

```ts
      if (struckNote !== undefined) return `[${struckNote}](#fleex-struck:${struckNote.slice(1)})`;
```

```ts
      if (activeNote !== undefined) return encodeNoteRef(activeNote);
```

The struck branch drops the `~~` markers, exactly like the five sibling struck branches above it — each captures without the tildes and emits `[@thing](#fleex-struck:thing)`. Do not invent a different shape for this one. Renumber the comment listing the capture groups.

- [ ] **Step 6: Rename the remaining callers**

```bash
grep -rn "preprocessTicketMentions" packages/web/src
```

Expected: `MarkdownRenderer.tsx` and `mentions.test.ts`. Rename both to `preprocessReferences`. `MarkdownRenderer.tsx` is rewritten in Task 3 — here, only make the import compile.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun run --filter '@fleex/web' test -- --run mentions`
Expected: PASS, including the pre-existing mention tests.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/components/markdown/mentions.ts packages/web/src/components/markdown/mentions.test.ts packages/web/src/components/scratchpad/MarkdownRenderer.tsx
git commit -m "feat(web): encode @scratchpad: references in both markdown processors"
```

---

### Task 3: La puce et le dégatage du rendu

**Files:**
- Create: `packages/web/src/components/markdown/NoteRefChip.tsx`
- Create: `packages/web/src/components/markdown/NoteRefChip.test.tsx`
- Modify: `packages/web/src/components/scratchpad/MarkdownRenderer.tsx:186-205,255-258`
- Modify: `packages/web/src/components/tickets/TicketComments.tsx:43,234-237`
- Modify: `packages/web/src/components/tickets/TicketComments.test.tsx`
- Modify: `packages/web/src/components/markdown/mentions.ts` (docblock only)
- Modify: `packages/web/src/components/markdown/mentions.test.ts` (describe label only)
- Delete: `packages/web/src/components/markdown/wiki.ts`, `wiki.test.ts`, `WikiLinkChip.tsx`, `packages/web/src/components/scratchpad/MarkdownRenderer.wiki-link.test.tsx`

**Interfaces:**
- Consumes: `SCRATCHPAD_REF_HREF_PREFIX`, `preprocessReferences` (Task 2); `GLOBAL_NOTE_KEY` (Task 1).
- Produces: `NoteRefChip({ noteKey, children }: { noteKey: string; children: ReactNode })`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/markdown/NoteRefChip.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';

function setEngine(engine: 'legacy' | 'semantic') {
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, memoryEngine: engine },
  });
}

beforeEach(() => setEngine('semantic'));

afterEach(() => {
  cleanup();
  useScratchpadStore.setState({ selectedScratchpadKey: null });
  setEngine('legacy');
});

const noop = () => {};

// The generic renderer backs the notes, the ticket description and deliverables,
// so a reference resolved here is resolved on all three.
describe('MarkdownRenderer — note references', () => {
  it('navigates to a repo note', () => {
    const { getByRole } = render(
      <MarkdownRenderer content="conventions live in @scratchpad:acme/app" onToggleCheckbox={noop} />,
    );
    fireEvent.click(getByRole('button'));
    expect(useUIStore.getState().activePanel).toBe('scratchpads');
    expect(useScratchpadStore.getState().selectedScratchpadKey).toBe('acme/app');
  });

  it('navigates to the global note', () => {
    const { getByRole } = render(
      <MarkdownRenderer content="see @scratchpad:global" onToggleCheckbox={noop} />,
    );
    fireEvent.click(getByRole('button'));
    expect(useScratchpadStore.getState().selectedScratchpadKey).toBe('__global__');
  });

  it('labels the global note Global rather than its storage key', () => {
    const { container } = render(
      <MarkdownRenderer content="see @scratchpad:global" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('Global');
    expect(container.textContent).not.toContain('__global__');
  });

  it('renders under the legacy engine', () => {
    // Navigating to a note reads no index, so it must not depend on the memory
    // engine — exactly as @ticket: never has.
    setEngine('legacy');
    const { getByRole } = render(
      <MarkdownRenderer content="see @scratchpad:acme/app" onToggleCheckbox={noop} />,
    );
    fireEvent.click(getByRole('button'));
    expect(useScratchpadStore.getState().selectedScratchpadKey).toBe('acme/app');
  });

  it('leaves a value that names no note as plain text', () => {
    const { container, queryByRole } = render(
      <MarkdownRenderer content="see @scratchpad:my-idea" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('@scratchpad:my-idea');
    expect(queryByRole('button')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@fleex/web' test -- --run NoteRefChip`
Expected: FAIL — no button found, because the renderer has no scratchpad branch yet.

- [ ] **Step 3: Write the chip**

Create `packages/web/src/components/markdown/NoteRefChip.tsx`:

```tsx
import type { ReactNode } from 'react';
import { GLOBAL_NOTE_KEY } from '@fleex/shared';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useUIStore } from '../../stores/uiStore';

/**
 * Inline chip for a `@scratchpad:` reference, rendered by every Markdown surface
 * via the `#fleex-scratchpad:` href.
 *
 * A reference resolves by key alone — the note may not exist yet, and refusing to
 * link to it would make the reference useless in the case it is most useful for:
 * writing the link before writing the note.
 */
export function NoteRefChip({ noteKey, children }: { noteKey: string; children: ReactNode }) {
  const isGlobal = noteKey === GLOBAL_NOTE_KEY;

  const open = () => {
    useUIStore.getState().setActivePanel('scratchpads');
    useScratchpadStore.getState().setSelectedScratchpadKey(noteKey);
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      title={isGlobal ? 'Global note' : `Note: ${noteKey}`}
      className="inline-flex max-w-full items-baseline gap-1 rounded-sm bg-[var(--theme-accent)]/12 px-1 py-px align-baseline text-[var(--theme-accent)] transition-colors hover:bg-[var(--theme-accent)]/25"
    >
      <svg
        width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        className="shrink-0 self-center"
      >
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
      <span className="truncate">{isGlobal ? 'Global' : children}</span>
    </button>
  );
}
```

- [ ] **Step 4: Rewire the renderer**

In `packages/web/src/components/scratchpad/MarkdownRenderer.tsx`:

Replace the wiki and settings imports with:

```ts
import { preprocessReferences, SCRATCHPAD_REF_HREF_PREFIX, TICKET_MENTION_HREF_PREFIX } from '../markdown/mentions';
import { NoteRefChip } from '../markdown/NoteRefChip';
```

Delete the `useSettingsStore` import, the `WikiLinkChip` import, and the `wikiEnabled` selector (lines 186-190) with its comment.

Replace the `processed` memo (lines 195-201) with:

```ts
  // Encode @ticket: and @scratchpad: references as #fleex-… links so the `a`
  // override can render them as chips. Inline-only (no line added or removed), so
  // the checkbox line indices computed from `contentWithoutImages` stay valid.
  const processed = useMemo(() => preprocessReferences(contentWithoutImages), [contentWithoutImages]);
```

Replace the wiki branch of the `a` override (lines 255-258) with:

```tsx
      // Note reference — `@scratchpad:global` or `@scratchpad:owner/name`
      if (href?.startsWith(SCRATCHPAD_REF_HREF_PREFIX)) {
        const noteKey = decodeURIComponent(href.slice(SCRATCHPAD_REF_HREF_PREFIX.length));
        return <NoteRefChip noteKey={noteKey}>{children}</NoteRefChip>;
      }
```

- [ ] **Step 5: Render the chip on the comment surface too**

Task 2 taught `preprocessMentions` to encode `@scratchpad:` for comments, but
`TicketComments.tsx` keeps its **own** `a` override — separate from the generic renderer —
and it has no branch for the new href. Without this step a note reference in a comment
renders as a dead in-page anchor, which is worse than the literal text it replaced.

In `packages/web/src/components/tickets/TicketComments.tsx`, extend the existing import on
line 43:

```ts
import { preprocessMentions, SCRATCHPAD_REF_HREF_PREFIX, TICKET_MENTION_HREF_PREFIX } from '../markdown/mentions';
import { NoteRefChip } from '../markdown/NoteRefChip';
```

Then add a branch immediately after the ticket-reference branch (currently lines 234-237), so
the two referential chips sit together:

```tsx
      if (href?.startsWith(SCRATCHPAD_REF_HREF_PREFIX)) {
        // Note reference — referential like a ticket chip, navigates to the note.
        const noteKey = decodeURIComponent(href.slice(SCRATCHPAD_REF_HREF_PREFIX.length));
        return <NoteRefChip noteKey={noteKey}>{children}</NoteRefChip>;
      }
```

Add two cases to the existing `CommentMarkdown — mention chips` block in
`packages/web/src/components/tickets/TicketComments.test.tsx`, in that file's own idiom —
its header comment already states the rule this enforces, "never as a plain link to a
`#fleex-…` href":

```tsx
  it('renders a @scratchpad: reference as a chip, not a link', () => {
    renderBody('conventions in @scratchpad:acme/app');
    const chip = screen.getByText('@scratchpad:acme/app');
    expect(chip.closest('a')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('labels the global note reference Global', () => {
    renderBody('see @scratchpad:global');
    expect(screen.getByText('Global')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
```

Run: `bun run --filter '@fleex/web' test -- --run TicketComments`
Expected: PASS, including the two pre-existing chip cases.

- [ ] **Step 6: Correct two stale comments left by Task 2**

Both are comment-accuracy defects — a comment describing behaviour the code no longer has.

In `packages/web/src/components/markdown/mentions.test.ts:6`, the describe label still reads
`preprocessReferences (ticket-only — used by the generic Markdown renderer)`. It is no longer
ticket-only. Change the parenthetical to `used by the generic Markdown renderer`.

In `packages/web/src/components/markdown/mentions.ts`, the `Mapping:` table above
`ALL_MENTIONS` lists every encoded type but omits the new one. Add the row, in the table's
existing alignment:

```
 *   @scratchpad:value  →  [@scratchpad:value](#fleex-scratchpad:key)
```

And in the file header, the bullet describing `preprocessMentions` still says it encodes
"agent / panel / skill / human / ticket" — add note references to that list.

- [ ] **Step 7: Delete the wiki-link layer**

```bash
git rm packages/web/src/components/markdown/wiki.ts \
       packages/web/src/components/markdown/wiki.test.ts \
       packages/web/src/components/markdown/WikiLinkChip.tsx \
       packages/web/src/components/scratchpad/MarkdownRenderer.wiki-link.test.tsx
```

Then confirm nothing still imports them:

```bash
grep -rn "WikiLinkChip\|preprocessWikiLinks\|WIKI_LINK_HREF_PREFIX\|decodeWikiTarget" packages/web/src
```

Expected: no output.

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun run --filter '@fleex/web' test -- --run NoteRefChip`
Expected: PASS, 5 tests.

Run: `bun run --filter '@fleex/web' test`
Expected: PASS — the whole suite, every file. The measured baseline before this task is
76 files (2 failed, 74 passed) and 656 tests (18 failed, 638 passed); every one of those 18
failures lives in the two files this task deletes, or in the renderer call this task removes.
They must disappear by deletion and rewiring — **never** by skipping or marking a test.

Run: `bun run --filter '@fleex/web' build`
Expected: succeeds. This is the first green web typecheck since Task 1.

- [ ] **Step 9: Commit**

```bash
git add -A packages/web/src/components/markdown packages/web/src/components/scratchpad packages/web/src/components/tickets
git commit -m "feat(web): render @scratchpad: chips on every markdown surface

Both a overrides get the branch — the generic renderer and the comment one —
so a reference in a comment is a chip rather than a dead in-page anchor.
Navigation reads no index, so it no longer depends on the memory engine."
```

---

### Task 4: Renommer le drapeau

Renommage pur, aucun changement de comportement. Atomique par nature : un renommage partiel ne compile pas.

**Files:**
- Modify: `packages/server/src/application/ports/config.port.ts:110,136`
- Modify: `packages/cli/src/commands/memory/_shared.ts:61-75`
- Modify: `packages/web/src/stores/settingsStore.ts:79`
- Modify: `packages/web/src/components/settings/MemoryTab.tsx:17-20,84-88`
- Modify: `packages/server/src/infrastructure/http/scratchpad.routes.ts:76`
- Modify: `packages/web/src/components/scratchpad/NoteLinksPanel.tsx:19-20`
- Modify: `packages/server/tests/unit/memory-feature-flags.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: la clé `relatedNotes` remplace `wikiLinks` dans `MemoryFeatureFlags` et dans les deux `MEMORY_FEATURE_KEYS`.

- [ ] **Step 1: Locate every occurrence**

```bash
grep -rn "wikiLinks" --include="*.ts" --include="*.tsx" --include="*.md" . | grep -v node_modules
```

Expected: the seven files above plus `README.md` (Task 8) and the spec (leave the spec alone — it records the decision).

- [ ] **Step 2: Rename in the server config port**

In `packages/server/src/application/ports/config.port.ts`, replace the `wikiLinks` field:

```ts
  /** Surface notes the index finds semantically close to the one being read. */
  relatedNotes?: boolean;
```

And in `MEMORY_FEATURE_KEYS`, replace `'wikiLinks',` with `'relatedNotes',` — same position, so the Settings panel order is unchanged.

- [ ] **Step 3: Rename in the CLI**

In `packages/cli/src/commands/memory/_shared.ts`, replace `'wikiLinks',` with `'relatedNotes',` in `MEMORY_FEATURE_KEYS`.

This list **duplicates** the server's instead of importing it. Add the note above it so the next person knows:

```ts
/**
 * The switchable features that consume the index — the same set the Settings
 * panel lists, in the same order.
 *
 * Duplicated from the server's `MEMORY_FEATURE_KEYS` rather than imported: a key
 * added here and not there is silently accepted by `--enable` and ignored by the
 * server. Keep the two in step.
 */
```

- [ ] **Step 4: Rename in the web**

- `packages/web/src/stores/settingsStore.ts:79` — the `memoryFeatures` shape: `wikiLinks?: boolean` → `relatedNotes?: boolean`.
- `packages/web/src/components/settings/MemoryTab.tsx:19` — in the `MemoryFeatureKey` union, `'wikiLinks'` → `'relatedNotes'`.
- `packages/web/src/components/settings/MemoryTab.tsx:84-88` — the feature entry:

```ts
  {
    key: 'relatedNotes',
    label: 'Relate notes',
    description: 'Surfaces notes the index finds close to the one you are reading — the connections nobody thought to write a link for. Explicit @scratchpad: references and their backlinks work without this, and without the semantic engine.',
  },
```

- `packages/web/src/components/scratchpad/NoteLinksPanel.tsx:19-20` — `memoryFeatures?.wikiLinks` → `memoryFeatures?.relatedNotes`.
- `packages/server/src/infrastructure/http/scratchpad.routes.ts:76` — `isMemoryFeatureEnabled(container.config.get(), 'wikiLinks')` → `'relatedNotes'`.

- [ ] **Step 5: Rename in the flags test**

In `packages/server/tests/unit/memory-feature-flags.test.ts`, replace every `wikiLinks` with `relatedNotes`.

- [ ] **Step 6: Verify no occurrence survives in code**

```bash
grep -rn "wikiLinks" --include="*.ts" --include="*.tsx" . | grep -v node_modules
```

Expected: no output.

- [ ] **Step 7: Run the suites and typecheck**

Run: `bun run --filter '@fleex/server' test`
Expected: PASS.

Run: `bun run --filter '@fleex/web' build`
Expected: succeeds — the web side went green at Task 3.

Do **not** run the server build here and do not try to make it pass. Task 1 removed
`linksTo` from `@fleex/shared` and `scratchpad.routes.ts:3` still imports it; that import is
Task 5's to swap. The server typecheck is red by design from Task 1 until Task 5 step 5, and
"fixing" it here would pull Task 5's deliverable into this task.

- [ ] **Step 8: Commit**

```bash
git add -A packages/server packages/web packages/cli
git commit -m "refactor(memory): rename the wikiLinks flag to relatedNotes

It gates the one half that reads the vector index. The chip and the exact
backlinks read no index and leave the flag family in the next commit."
```

---

### Task 5: Déplacer le garde

**Files:**
- Modify: `packages/server/src/infrastructure/http/scratchpad.routes.ts:74-104`
- Modify: `packages/web/src/components/scratchpad/NoteLinksPanel.tsx:19-40`
- Create: `packages/server/tests/unit/note-backlinks.test.ts`

**Interfaces:**
- Consumes: `referencesNote` (Task 1), the `relatedNotes` key (Task 4).
- Produces: `GET /api/scratchpads/links` returns exact backlinks unconditionally; `related` is populated only when `relatedNotes` is enabled AND the engine is semantic.

- [ ] **Step 1: Write the failing test**

This task's deliverable is the *gating*, so the test must drive the route, not the parser.
The repo's pattern for this is a Fastify instance with a stub container — see
`packages/server/tests/unit/execution-log-routine-scope.test.ts`, which registers one route
module against a hand-rolled container cast to `any` and drives it with `app.inject`.

Create `packages/server/tests/unit/note-backlinks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { scratchpadRoutes } from '../../src/infrastructure/http/scratchpad.routes.js';
import type { AppConfig } from '../../src/application/ports/config.port.js';

// ---------------------------------------------------------------------------
// Navigating between notes reads no index, so backlinks must survive the legacy
// engine and a disabled flag — exactly as @ticket: always has. Only the
// `related` half queries the retrieval index, so only it answers to the flag.
// These tests pin that split at the payload level.
// ---------------------------------------------------------------------------

const NOTES: Record<string, string> = {
  'scratchpad:__global__': 'index of everything, conventions in @scratchpad:acme/app',
  'scratchpad:acme/app': 'repo notes. see @scratchpad:global for the index',
  'scratchpad:acme/other': 'unrelated prose about scratchpads in general',
};

function makeContainer(config: Partial<AppConfig>) {
  return {
    config: { get: () => config as AppConfig },
    kvStore: {
      get: async (key: string) => NOTES[key] ?? null,
      listByPrefix: async () => Object.entries(NOTES).map(([key, value]) => ({ key, value })),
      set: async () => {},
    },
    // Reached only when the related half is live; returning a hit lets us prove
    // the flag is what silences it, not an empty index.
    retrieveContext: {
      search: async () => [{ sourceId: 'acme/app', score: 0.9 }],
    },
    eventBus: { emit: () => {} },
    hostFs: { exists: async () => false, readFile: async () => '' },
    hostHomedir: '/tmp/fleex-test-home',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function links(config: Partial<AppConfig>, key: string, target: string) {
  const app: FastifyInstance = Fastify({ logger: false });
  await app.register(scratchpadRoutes(makeContainer(config)));
  await app.ready();
  const res = await app.inject({
    method: 'GET',
    url: `/api/scratchpads/links?key=${encodeURIComponent(key)}&target=${encodeURIComponent(target)}`,
  });
  expect(res.statusCode).toBe(200);
  await app.close();
  return res.json() as { backlinks: Array<{ key: string; label: string }>; related: Array<{ key: string }> };
}

const SEMANTIC = { memoryEngine: 'semantic' as const };
const LEGACY = { memoryEngine: 'legacy' as const };

describe('GET /api/scratchpads/links', () => {
  it('reports who references the global note', async () => {
    const body = await links(SEMANTIC, '__global__', '__global__');
    expect(body.backlinks.map((b) => b.key)).toEqual(['acme/app']);
  });

  it('labels the global note Global rather than its storage key', async () => {
    const body = await links(SEMANTIC, 'acme/app', 'acme/app');
    expect(body.backlinks).toEqual([{ key: '__global__', label: 'Global' }]);
  });

  it('does not list a note as its own backlink', async () => {
    // acme/app references global, and global references acme/app; asking about
    // acme/app from acme/app must not return acme/app.
    const body = await links(SEMANTIC, 'acme/app', 'acme/app');
    expect(body.backlinks.map((b) => b.key)).not.toContain('acme/app');
  });

  it('ignores prose that merely talks about scratchpads', async () => {
    const body = await links(SEMANTIC, '__global__', '__global__');
    expect(body.backlinks.map((b) => b.key)).not.toContain('acme/other');
  });

  it('returns backlinks under the legacy engine', async () => {
    // The whole point of this task: a text scan over a handful of notes needs no
    // index, so it must not answer to the memory engine.
    const body = await links(LEGACY, '__global__', '__global__');
    expect(body.backlinks.map((b) => b.key)).toEqual(['acme/app']);
    expect(body.related).toEqual([]);
  });

  it('returns backlinks when relatedNotes is off, and no related', async () => {
    const body = await links({ ...SEMANTIC, memoryFeatures: { relatedNotes: false } }, '__global__', '__global__');
    expect(body.backlinks.map((b) => b.key)).toEqual(['acme/app']);
    expect(body.related).toEqual([]);
  });

  it('returns related notes when the flag and the engine are both on', async () => {
    const body = await links(SEMANTIC, '__global__', '__global__');
    expect(body.related.map((r) => r.key)).toEqual(['acme/app']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@fleex/server' test -- --run note-backlinks`
Expected: FAIL. Two distinct failures are expected before step 3: the module does not
compile, because `scratchpad.routes.ts` still imports the `linksTo` that Task 1 deleted; and
once that is fixed, the legacy-engine and flag-off cases return empty backlinks, because the
early return is still in place. Both are the point of this task.

- [ ] **Step 3: Move the gate in the route**

In `packages/server/src/infrastructure/http/scratchpad.routes.ts`:

Change the import on line 3:

```ts
import { referencesNote } from '@fleex/shared';
```

Replace the whole `/api/scratchpads/links` handler body with:

```ts
      async (request) => {
        const target = request.query.target?.trim();
        const backlinks: Array<{ key: string; label: string }> = [];

        // Exact backlinks are a text scan over a handful of notes — no index, so
        // no feature flag and no engine requirement. Navigating between notes is
        // not semantic memory, exactly as @ticket: has never been.
        if (target && kvStore) {
          for (const entry of await kvStore.listByPrefix('scratchpad:')) {
            const key = entry.key.slice('scratchpad:'.length);
            // A note listing itself as its own backlink is noise.
            if (key === request.query.key) continue;
            if (referencesNote(entry.value, target)) {
              backlinks.push({ key, label: key === '__global__' ? 'Global' : key });
            }
          }
        }

        // Related notes come from the index, so they surface connections nobody
        // thought to write a reference for — which is the half of a knowledge
        // graph manual linking never produces, and the half that needs the flag.
        const sourceKey = request.query.key?.trim();
        const related = sourceKey && kvStore
          && isMemoryFeatureEnabled(container.config.get(), 'relatedNotes')
          ? await relatedNotes(container, sourceKey)
          : [];

        return { backlinks, related };
      },
```

The early `if (!isMemoryFeatureEnabled(…)) return { backlinks: [], related: [] }` is gone. Update the handler's doc comment to say the backlink half is unconditional and the related half is flagged.

- [ ] **Step 4: Ungate the panel**

In `packages/web/src/components/scratchpad/NoteLinksPanel.tsx`, delete the `enabled` selector and the `useSettingsStore` import, and simplify the effect:

```ts
  useEffect(() => {
    setLinks(null);
    void load();
  }, [load]);

  if (!links) return null;
  if (links.backlinks.length === 0 && links.related.length === 0) return null;
```

Update the component's doc comment: backlinks are always computed; `related` arrives empty when the flag is off or the engine is legacy, so the panel degrades to a backlink list rather than disappearing.

- [ ] **Step 5: Run tests and typecheck**

Run: `bun run --filter '@fleex/server' test -- --run note-backlinks`
Expected: PASS, 7 tests. This is also the first green `@fleex/server` typecheck since
Task 1 — the `linksTo` import is gone.

Run: `bun run --filter '@fleex/server' build && bun run --filter '@fleex/web' build`
Expected: both succeed.

- [ ] **Step 6: Verify by hand against the running server**

The server's port is assigned per instance — do not assume 3000. Read it from
`fleex status` (the `server` row's URL), or derive it:

```bash
API=$(fleex status | awk '/server/ {print $(NF)}')
fleex memory engine legacy
curl -s "$API/api/scratchpads/links?key=__global__&target=__global__" | head -c 300
```

Expected: a JSON body whose `related` is `[]` and whose `backlinks` reflects the real notes — proving backlinks survive the legacy engine.

```bash
fleex memory engine semantic
```

Expected: restore the previous engine. Do not leave the instance on `legacy`.

- [ ] **Step 7: Commit**

```bash
git add -A packages/server packages/web
git commit -m "feat(memory): keep note navigation working without the semantic engine

Exact backlinks are a text scan over a handful of notes. Only the related
half reads the vector index, so only it stays behind relatedNotes."
```

---

### Task 6: Extraire l'autocomplétion

Refactor pur : `TicketComments` doit se comporter à l'identique après cette tâche.

**Files:**
- Create: `packages/web/src/components/markdown/MentionMenu.tsx`
- Create: `packages/web/src/components/markdown/useMentionAutocomplete.ts`
- Create: `packages/web/src/components/markdown/useMentionAutocomplete.test.ts`
- Modify: `packages/web/src/components/ui/MentionTypeBadge.tsx:9,16-23`
- Modify: `packages/web/src/components/tickets/TicketComments.tsx:470-525,563-566,737-748,1245-1290,1652-1660`

**Interfaces:**
- Consumes: `MentionTargetType` from `../ui/MentionTypeBadge`; `MentionTypeIcon` from `../../lib/primitives`.
- Produces:
  - `interface MentionOption { insertText: string; label: string; type: MentionTargetType; deferred?: boolean }`
  - `MentionMenu({ options, selectedIndex, onSelect, position }): ReactNode`
  - `useMentionAutocomplete({ options, value, onChange, textareaRef }): { open, filtered, index, onScan, onKeyDown, close, accept }` where `onKeyDown(e): boolean` returns `true` when it consumed the event.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/markdown/useMentionAutocomplete.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterMentionOptions, detectMentionTrigger, MAX_DEFERRED_SUGGESTIONS } from './useMentionAutocomplete';
import type { MentionOption } from './MentionMenu';

const OPTIONS: MentionOption[] = [
  { insertText: '@agent:catalyst', label: 'Catalyst', type: 'agent' },
  { insertText: '@skill:commit', label: 'commit', type: 'skill' },
  { insertText: '@scratchpad:global', label: 'Global', type: 'scratchpad' },
  ...Array.from({ length: 12 }, (_, i) => ({
    insertText: `@ticket:${i + 1}`,
    label: `#${i + 1} Ticket ${i + 1}`,
    type: 'ticket' as const,
    deferred: true,
  })),
];

describe('detectMentionTrigger', () => {
  it('opens on an @ at the start of the text', () => {
    expect(detectMentionTrigger('@cat', 4)).toEqual({ triggerPos: 0, query: 'cat' });
  });

  it('opens on an @ preceded by whitespace', () => {
    expect(detectMentionTrigger('hello @cat', 10)).toEqual({ triggerPos: 6, query: 'cat' });
  });

  it('stays closed for an @ glued to a previous word (an email address)', () => {
    expect(detectMentionTrigger('write to me@example.com', 23)).toBeNull();
  });

  it('closes once a space follows the @', () => {
    expect(detectMentionTrigger('@agent:catalyst do it', 21)).toBeNull();
  });

  it('strips the primitive prefix so the query matches the label', () => {
    // Typing "@agent:cat" must match "Catalyst", and "@ticket:37" must match #37.
    expect(detectMentionTrigger('@agent:cat', 10)?.query).toBe('cat');
    expect(detectMentionTrigger('@scratchpad:acm', 15)?.query).toBe('acm');
  });

  it('reads the text before the cursor, not the whole value', () => {
    expect(detectMentionTrigger('@cat and more', 4)).toEqual({ triggerPos: 0, query: 'cat' });
  });
});

describe('filterMentionOptions', () => {
  it('shows only non-deferred options for a bare @', () => {
    // A bare "@" would otherwise dump every ticket into the dropdown.
    const out = filterMentionOptions(OPTIONS, '');
    expect(out.every((o) => !o.deferred)).toBe(true);
    expect(out).toHaveLength(3);
  });

  it('matches on label', () => {
    expect(filterMentionOptions(OPTIONS, 'cataly').map((o) => o.insertText)).toEqual(['@agent:catalyst']);
  });

  it('matches on insert text', () => {
    expect(filterMentionOptions(OPTIONS, 'scratchpad').map((o) => o.insertText)).toEqual(['@scratchpad:global']);
  });

  it('caps deferred matches so a long list stays usable', () => {
    const out = filterMentionOptions(OPTIONS, 'ticket');
    expect(out.filter((o) => o.deferred)).toHaveLength(MAX_DEFERRED_SUGGESTIONS);
  });

  it('puts non-deferred options before deferred ones', () => {
    // 'c' matches all three immediate options and every ticket, so the ordering
    // is what the assertion actually measures.
    const out = filterMentionOptions(OPTIONS, 'c');
    expect(out[0]?.deferred).not.toBe(true);
    expect(out.some((o) => o.deferred)).toBe(true);
  });

  it('returns nothing when no option matches', () => {
    expect(filterMentionOptions(OPTIONS, 'zzzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@fleex/web' test -- --run useMentionAutocomplete`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the note mention type**

The test above uses `type: 'scratchpad'`, so the union has to accept it before the extraction compiles. In `packages/web/src/components/ui/MentionTypeBadge.tsx`, extend line 9 and the meta map:

```ts
export type MentionTargetType = 'agent' | 'human' | 'panel' | 'skill' | 'workflow' | 'ticket' | 'scratchpad';
```

```ts
  scratchpad: { letter: 'N', hue: 'teal' },
```

`N` for note, and `teal` is the one hue no other mention type claims. `MentionTypeIcon` has no primitive glyph for `scratchpad`, so it falls through to this badge — the intended path, since a note is not a launchable primitive. Update the type's doc comment to cover note references alongside the server's mention targets.

- [ ] **Step 4: Extract the menu**

Create `packages/web/src/components/markdown/MentionMenu.tsx`, moving `MentionOption` (`TicketComments.tsx:474-482`) and `MentionAutocomplete` (`483-525`) verbatim, renamed:

```tsx
import { useEffect, useRef } from 'react';
import { MentionTypeIcon } from '../../lib/primitives';
import type { MentionTargetType } from '../ui/MentionTypeBadge';

export interface MentionOption {
  /** The text inserted into the textarea (e.g. "@agent:catalyst" or "@olivier") */
  insertText: string;
  /** Display label shown in the dropdown */
  label: string;
  /** Secondary text, and the icon shown beside the label */
  type: MentionTargetType;
  /**
   * Hidden until the user types a query, then capped.
   *
   * For kinds that can be numerous — tickets — where a bare `@` would otherwise
   * dump the whole list into the dropdown.
   */
  deferred?: boolean;
}

export function MentionMenu({
  options,
  selectedIndex,
  onSelect,
  position,
}: {
  options: MentionOption[];
  selectedIndex: number;
  onSelect: (opt: MentionOption) => void;
  position: { bottom: number; left: number };
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (options.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute z-30 max-h-48 min-w-[200px] overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
      style={{ bottom: position.bottom, left: position.left }}
    >
      {options.map((opt, i) => (
        <button
          key={opt.insertText}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
            i === selectedIndex
              ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-text-primary)]'
              : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
          }`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(opt); }}
        >
          <MentionTypeIcon type={opt.type} />
          <span className="flex-1 truncate font-medium">{opt.label}</span>
          <span className="text-[10px] text-[var(--theme-text-faint)]">{opt.type}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Extract the hook**

Create `packages/web/src/components/markdown/useMentionAutocomplete.ts`:

```ts
import { useCallback, useMemo, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from 'react';
import type { MentionOption } from './MentionMenu';

/**
 * `@mention` autocomplete for any Markdown textarea.
 *
 * Knows nothing about which primitives exist: the option list is a parameter, so
 * the comment composer offers its six kinds and the note editor offers the two
 * that navigate somewhere. A hook that enumerated primitives itself would have to
 * be edited every time a surface wanted a different subset.
 */

/** Deferred matches shown at once, so a long list stays usable. */
export const MAX_DEFERRED_SUGGESTIONS = 8;

/** Primitive prefixes stripped from the query, so "@agent:cat" matches "Catalyst". */
const PRIMITIVE_PREFIX = /^(agent|panel|skill|workflow|routine|ticket|scratchpad):/;

/**
 * Whether the caret sits inside an `@mention` being typed, and what has been
 * typed so far.
 *
 * The `@` must start the text or follow whitespace — otherwise the `@` of an
 * email address would open the menu on every address the user writes.
 */
export function detectMentionTrigger(value: string, cursor: number): { triggerPos: number; query: string } | null {
  const before = value.slice(0, cursor);
  const atIdx = before.lastIndexOf('@');
  if (atIdx < 0) return null;
  if (atIdx !== 0 && !/\s/.test(before[atIdx - 1]!)) return null;

  const fragment = before.slice(atIdx + 1);
  // A space means the mention is finished and the user has moved on.
  if (/\s/.test(fragment)) return null;

  return { triggerPos: atIdx, query: fragment.replace(PRIMITIVE_PREFIX, '') };
}

/** Options matching `query`, non-deferred first, deferred capped. */
export function filterMentionOptions(options: MentionOption[], query: string): MentionOption[] {
  const q = query.toLowerCase();
  const matches = (o: MentionOption) =>
    o.label.toLowerCase().includes(q) || o.insertText.toLowerCase().includes(q);

  const immediate = options.filter((o) => !o.deferred && matches(o));
  // A bare "@" must not dump a long list into the dropdown.
  if (q.length === 0) return immediate;

  const deferred = options.filter((o) => o.deferred && matches(o)).slice(0, MAX_DEFERRED_SUGGESTIONS);
  return [...immediate, ...deferred];
}

export function useMentionAutocomplete({
  options,
  value,
  onChange,
  textareaRef,
}: {
  options: MentionOption[];
  value: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [triggerPos, setTriggerPos] = useState(-1);

  const filtered = useMemo(
    () => (open ? filterMentionOptions(options, query) : []),
    [open, options, query],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setIndex(0);
    setTriggerPos(-1);
  }, []);

  const accept = useCallback((opt: MentionOption) => {
    const ta = textareaRef.current;
    if (!ta || triggerPos < 0) return;
    // Replace from the '@' trigger to the caret with the insert text + a space.
    const next = value.slice(0, triggerPos) + opt.insertText + ' ' + value.slice(ta.selectionStart);
    onChange(next);
    close();
    // Restore the caret after React re-renders.
    const caret = triggerPos + opt.insertText.length + 1;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  }, [value, onChange, triggerPos, close, textareaRef]);

  const onScan = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const hit = detectMentionTrigger(e.target.value, e.target.selectionStart);
    if (!hit) {
      close();
      return;
    }
    setOpen(true);
    setTriggerPos(hit.triggerPos);
    setQuery(hit.query);
    setIndex(0);
  }, [close]);

  /** Returns true when the menu consumed the event, so the caller can stop. */
  const onKeyDown = useCallback((e: KeyboardEvent): boolean => {
    if (!open || filtered.length === 0) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (i + 1) % filtered.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (i - 1 + filtered.length) % filtered.length);
      return true;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      accept(filtered[index]!);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return true;
    }
    return false;
  }, [open, filtered, index, accept, close]);

  return { open, filtered, index, onScan, onKeyDown, close, accept };
}
```

- [ ] **Step 6: Run the hook test to verify it passes**

Run: `bun run --filter '@fleex/web' test -- --run useMentionAutocomplete`
Expected: PASS, 12 tests.

- [ ] **Step 7: Rewire `TicketComments` onto the hook**

Delete `MentionOption` (474-482) and `MentionAutocomplete` (483-525) and import instead:

```ts
import { MentionMenu, type MentionOption } from '../markdown/MentionMenu';
import { useMentionAutocomplete } from '../markdown/useMentionAutocomplete';
```

Delete the four state declarations (563-566), `closeMentionAc`, `acceptMention`, `handleMentionScan`, `filteredOptions` and `MAX_TICKET_SUGGESTIONS`. In `allMentionOptions`, mark tickets deferred:

```ts
    for (const t of allTickets) {
      opts.push({
        insertText: `@ticket:${t.displayId}`,
        label: `#${t.displayId} ${t.title}`,
        type: 'ticket' as const,
        deferred: true,
      });
    }
```

Add the hook after `allMentionOptions`:

```ts
  const mentionAc = useMentionAutocomplete({
    options: allMentionOptions,
    value: body,
    onChange: setBody,
    textareaRef,
  });
```

In `handleKeyDown`, replace the whole autocomplete block with an early return:

```ts
      if (mentionAc.onKeyDown(e)) return;
```

and swap `acOpen, filteredOptions, acIndex, acceptMention, closeMentionAc` for `mentionAc` in the dependency array.

At the render site, replace the `textareaProps` and `overlay`:

```tsx
          textareaProps={{
            onChange: mentionAc.onScan,
            onKeyDown: handleKeyDown,
            onPaste: commentFileUpload.pasteHandler,
            onBlur: () => { setTimeout(mentionAc.close, 150); },
          }}
          overlay={
            mentionAc.open && mentionAc.filtered.length > 0 ? (
              <MentionMenu
                options={mentionAc.filtered}
                selectedIndex={mentionAc.index}
                onSelect={mentionAc.accept}
                position={{ bottom: (textareaRef.current?.offsetHeight ?? 36) + 8, left: 0 }}
              />
            ) : null
          }
```

- [ ] **Step 8: Verify the refactor changed no behaviour**

Run: `bun run --filter '@fleex/web' test -- --run TicketComments`
Expected: PASS, unchanged from before this task.

Run: `bun run --filter '@fleex/web' build`
Expected: succeeds.

- [ ] **Step 9: Commit**

```bash
git add -A packages/web/src/components/markdown packages/web/src/components/tickets/TicketComments.tsx
git commit -m "refactor(web): extract mention autocomplete out of TicketComments

The option list becomes a parameter, so any markdown textarea can offer the
subset of primitives that means something on its surface."
```

---

### Task 7: Brancher l'autocomplétion sur l'éditeur de notes

**Files:**
- Modify: `packages/web/src/components/scratchpad/ScratchpadMainView.tsx`
- Create: `packages/web/src/components/scratchpad/ScratchpadMainView.mentions.test.tsx`

**Interfaces:**
- Consumes: `useMentionAutocomplete`, `MentionMenu`, `MentionOption` (Task 6); `useScratchpadStore.scratchpadList`; `useTicketStore.tickets`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/scratchpad/ScratchpadMainView.mentions.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { Ticket } from '@fleex/shared';
import { ScratchpadMainView } from './ScratchpadMainView';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useTicketStore } from '../../stores/ticketStore';

function ticket(id: string, displayId: number, title: string): Ticket {
  return { id, displayId, title, boardId: 'b1' } as unknown as Ticket;
}

beforeEach(() => {
  useTicketStore.setState({ tickets: [ticket('t1', 42, 'Session tokens expire early')] });
  useScratchpadStore.setState({
    entries: { __global__: { content: '', loaded: true, saving: false, savedAt: null, dirty: false } },
    scratchpadList: [
      { key: '__global__', label: 'Global', lineCount: 3 },
      { key: 'acme/app', label: 'acme/app', lineCount: 0 },
    ],
    scratchpadListLoaded: true,
  });
});

afterEach(() => {
  cleanup();
  useTicketStore.setState({ tickets: [] });
});

function typeAt(el: HTMLTextAreaElement, value: string) {
  el.value = value;
  el.selectionStart = value.length;
  el.selectionEnd = value.length;
  fireEvent.change(el, { target: { value, selectionStart: value.length } });
}

// The note editor offers only what navigates somewhere: an agent or a skill
// dispatches nothing from a note and renders no chip there, so offering it would
// insert dead text.
describe('ScratchpadMainView — mention autocomplete', () => {
  it('offers the notes on a bare @', () => {
    const { container, getByText } = render(<ScratchpadMainView scratchpadKey="__global__" />);
    typeAt(container.querySelector('textarea')!, '@');
    expect(getByText('Global')).toBeTruthy();
    expect(getByText('acme/app')).toBeTruthy();
  });

  it('offers no agent, skill, panel or workflow', () => {
    const { container, queryByText } = render(<ScratchpadMainView scratchpadKey="__global__" />);
    typeAt(container.querySelector('textarea')!, '@');
    expect(queryByText('agent')).toBeNull();
    expect(queryByText('skill')).toBeNull();
    expect(queryByText('workflow')).toBeNull();
  });

  it('offers a ticket once a query narrows it', () => {
    const { container, getByText } = render(<ScratchpadMainView scratchpadKey="__global__" />);
    typeAt(container.querySelector('textarea')!, '@token');
    expect(getByText('#42 Session tokens expire early')).toBeTruthy();
  });

  it('inserts the reference syntax for the chosen note', () => {
    const { container, getByText } = render(<ScratchpadMainView scratchpadKey="__global__" />);
    const ta = container.querySelector('textarea')!;
    typeAt(ta, 'see @acme');
    fireEvent.mouseDown(getByText('acme/app'));
    expect(useScratchpadStore.getState().entries['__global__']?.content).toBe('see @scratchpad:acme/app ');
  });

  it('inserts the global note as @scratchpad:global, not its storage key', () => {
    const { container, getByText } = render(<ScratchpadMainView scratchpadKey="__global__" />);
    typeAt(container.querySelector('textarea')!, '@Glob');
    fireEvent.mouseDown(getByText('Global'));
    expect(useScratchpadStore.getState().entries['__global__']?.content).toBe('@scratchpad:global ');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@fleex/web' test -- --run ScratchpadMainView`
Expected: FAIL — no menu renders, the note editor has no autocomplete.

- [ ] **Step 3: Wire the editor**

In `packages/web/src/components/scratchpad/ScratchpadMainView.tsx`, add the imports:

```ts
import { useMemo } from 'react';
import { GLOBAL_NOTE_KEY } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { MentionMenu, type MentionOption } from '../markdown/MentionMenu';
import { useMentionAutocomplete } from '../markdown/useMentionAutocomplete';
```

Add the store reads and the option list, after `textareaRef`:

```ts
  const scratchpadList = useScratchpadStore((s) => s.scratchpadList);
  const tickets = useTicketStore((s) => s.tickets);

  // Only the two primitives that navigate somewhere from a note. An @agent: or
  // @skill: dispatches nothing here and renders no chip on this surface, so
  // offering it would insert dead text.
  const mentionOptions = useMemo<MentionOption[]>(() => {
    const notes: MentionOption[] = scratchpadList.map((note) => ({
      // The reference syntax spells the global note `global`; `__global__` is a
      // storage key and must never reach the document.
      insertText: `@scratchpad:${note.key === GLOBAL_NOTE_KEY ? 'global' : note.key}`,
      label: note.label,
      type: 'scratchpad' as const,
    }));
    const ticketOpts: MentionOption[] = tickets.map((t) => ({
      insertText: `@ticket:${t.displayId}`,
      label: `#${t.displayId} ${t.title}`,
      type: 'ticket' as const,
      deferred: true,
    }));
    return [...notes, ...ticketOpts];
  }, [scratchpadList, tickets]);

  const mentionAc = useMentionAutocomplete({
    options: mentionOptions,
    value: entry.content,
    onChange: handleChange,
    textareaRef,
  });
```

`handleChange` is declared below `textareaRef` today — move its `useCallback` above this block so the hook can reference it.

Then pass the wiring to `MarkdownEditor`:

```tsx
        textareaProps={{
          spellCheck: false,
          onChange: mentionAc.onScan,
          onKeyDown: (e) => { mentionAc.onKeyDown(e); },
          onBlur: () => { setTimeout(mentionAc.close, 150); },
        }}
        overlay={
          mentionAc.open && mentionAc.filtered.length > 0 ? (
            <MentionMenu
              options={mentionAc.filtered}
              selectedIndex={mentionAc.index}
              onSelect={mentionAc.accept}
              position={{ bottom: 8, left: 8 }}
            />
          ) : null
        }
```

`MarkdownEditor` already calls `textareaProps?.onChange` after its own handler (`MarkdownEditor.tsx:261`), so `onScan` runs in addition to the editor's own change handling, not instead of it. The note editor is the full-height variant, so the menu anchors to the bottom-left of the field rather than above a one-line composer.

- [ ] **Step 4: Load the note list from this component too**

`scratchpadList` has exactly one caller today: `ScratchpadsContent.tsx:18`, the sidebar list.
That component is **not** an ancestor of `ScratchpadMainView` — the main view is rendered by
`MainPanel.tsx:125`, so the two are siblings. Whenever the sidebar is on another panel or
unmounted, `scratchpadList` is empty and the autocomplete would offer no notes at all. The
editor therefore has to load it itself.

Add to `ScratchpadMainView`, mirroring the sidebar's call so the repo list reaches the
endpoint — `loadScratchpadList()` with no argument omits the `repos` querystring, and the
endpoint needs it to report configured repos that have no note yet:

```ts
  const loadScratchpadList = useScratchpadStore((s) => s.loadScratchpadList);
  const scratchpadListLoaded = useScratchpadStore((s) => s.scratchpadListLoaded);
  const resolvedRepositories = useSettingsStore((s) => s.settings.resolvedRepositories);

  // The sidebar list loads this too, but it is a sibling of this view rather than an
  // ancestor: with the sidebar on another panel there would be no notes to offer.
  useEffect(() => {
    if (!scratchpadListLoaded) void loadScratchpadList(resolvedRepositories);
  }, [scratchpadListLoaded, loadScratchpadList, resolvedRepositories]);
```

This needs `import { useSettingsStore } from '../../stores/settingsStore';` alongside the
imports added in step 3.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run --filter '@fleex/web' test -- --run ScratchpadMainView`
Expected: PASS, 5 tests.

Run: `bun run --filter '@fleex/web' test && bun run --filter '@fleex/web' build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add -A packages/web/src/components/scratchpad
git commit -m "feat(web): offer note and ticket references in the note editor

The vocabulary was invisible: nothing taught it and nothing hinted it
existed. Typing @ now lists what a note can point at."
```

---

### Task 8: Migration de contenu et documentation

**Files:**
- Modify: `README.md:138,162`
- Verify: the KV store carries no surviving `[[…]]`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Check the note store for surviving bracket links**

With the server running:

```bash
API=$(fleex status | awk '/server/ {print $(NF)}')
curl -s "$API/api/scratchpads" | API="$API" python3 -c "
import json,os,sys,urllib.request
api = os.environ['API']
for it in json.load(sys.stdin)['items']:
    key = it['key']
    url = api + '/api/scratchpad' if key == '__global__' else api + '/api/scratchpads/' + key
    body = json.load(urllib.request.urlopen(url)).get('content','')
    hits = [l for l in body.split('\n') if '[[' in l]
    if hits:
        print(key, '->', *hits, sep='\n  ')
"
```

Expected: at least one hit — this instance's Global note holds
`[[odys-travel/odys-proxy|coucou]]`, written by the user while testing the old syntax.

Rewrite each hit in the note's editor: `[[#42]]` → `@ticket:42`, `[[global]]` →
`@scratchpad:global`, `[[org/repo]]` → `@scratchpad:org/repo`. An unresolvable one like
`[[some idea]]` was never a link and needs nothing.

**The aliased form loses its label.** `[[target|label]]` had no equivalent in the new grammar —
no `@primitive:value` in Fleex takes an alias — so `[[odys-travel/odys-proxy|coucou]]` becomes
plain `@scratchpad:odys-travel/odys-proxy` and the word `coucou` is dropped. Here that word is
a throwaway test string, so nothing of value is lost. Where an alias carries real meaning, the
migration puts it in the surrounding prose rather than inventing alias syntax for one
primitive. Record every alias you drop in your report — this is a deliberate trade-off, and
the person reading the report is the one who chose the grammar.

- [ ] **Step 2: Confirm no code references the old syntax**

```bash
grep -rn "wiki\|\[\[" --include="*.ts" --include="*.tsx" packages/*/src | grep -v node_modules
```

Expected: no hit that concerns note links. Hits inside unrelated regexes (character classes) are fine — read each one rather than assuming.

- [ ] **Step 3: Update the README**

Line 138, the feature table row:

```markdown
| Relate notes | Surfaces notes the index finds close to the one you are reading | local |
```

Then add, in the same table's surrounding prose or right after it, a line documenting the syntax — it now works regardless of the memory engine, so it does not belong in the memory feature table:

```markdown
Write `@scratchpad:global` or `@scratchpad:owner/name` in any note, ticket description or comment to link to a note; type `@` in the editor to pick one. Backlinks appear under the note. Both work on either memory engine.
```

Line 162, the CLI example comment:

```
fleex memory links owner/app             # backlinks, and related notes when relatedNotes is on
```

- [ ] **Step 4: Run the whole suite**

Run: `bun run --filter '@fleex/server' test && bun run --filter '@fleex/web' test`
Expected: PASS.

Run: `bun run --filter '@fleex/shared' build && bun run --filter '@fleex/server' build && bun run --filter '@fleex/web' build`
Expected: all succeed.

- [ ] **Step 5: Verify end to end in the app**

1. **Nothing to build or restart.** The instance already runs every service in watch mode —
   `bun --conditions development --watch src/main.ts` for the server, `vite` for the web — and
   the `development` condition resolves `@fleex/shared` to `./src/index.ts`, so the shared
   parser is read from source too. Every change on this branch is already live. Confirm the
   three services are up with `fleex status` and read the web URL from it.

   Do **not** run `fleex self-update`: it executes `git pull --rebase origin main` inside this
   repo (`self-update/index.ts:163`), which would rewrite the history of a branch carrying an
   open PR.
2. Open a note, type `@` — the menu lists Global and each configured repo.
3. Pick one; the text becomes `@scratchpad:<key> `.
4. Switch the editor to preview; the reference is a chip; click it and the note opens.
5. In that second note, reference the first, then reopen the first: « Linked from » shows the second.
6. `fleex memory engine legacy`, reload: the chip and « Linked from » still work, « Related » is gone. Then `fleex memory engine semantic`.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: document @scratchpad: references and the relatedNotes flag"
```

- [ ] **Step 7: Update the recette artifact**

The artifact `789d95c3-ae74-47a2-a827-5c6a6d9abb59` (« Recette moteur mémoire ») carries the card that sent this whole investigation the wrong way. Rewrite it:

- Flag: `wikiLinks` → `relatedNotes`.
- API: `GET /api/scratchpads/links` — unchanged, but note that backlinks come back on either engine.
- UI: *Scratchpad* → type `@`, pick a note, the reference becomes a clickable chip. Panel « Linked from » / « Related » under the editor.
- Valide si: « Tape `@` dans une note : le menu liste Global et tes repos. Choisis-en un, passe en aperçu, clique la puce — elle navigue. Référence la note A depuis la note B, puis rouvre A : « Linked from » montre B. Les backlinks sortent aussi en moteur `legacy` ; seul « Related » disparaît. »

Do not write `[[une-autre-note]]` anywhere: it was never a valid reference, and it is what made this test fail.

---

## Auto-revue

**Couverture de la spec** — §1 grammaire → Task 1. §2.1 préprocesseurs → Task 2. §2.2 puce → Task 3. §2.3 renderer et dégatage → Task 3. §2.4 suppressions → Tasks 1 et 3. §3.1 extraction → Task 6. §3.2 câblage → Task 7. §4 backlinks → Task 5. §5 renommage → Task 4. §6 migration → Task 8 steps 1-2. §7 docs → Task 8 steps 3 et 7. §8 tests → répartis, un bloc de test par tâche.

**Cohérence des types** — `MentionOption` est défini une fois (Task 6, `MentionMenu.tsx`) et consommé sous ce nom en Tasks 6 et 7. `MentionTargetType` gagne `'scratchpad'` en Task 7, avant son unique usage dans les options de notes. `normaliseNoteKey` est produit en Task 1 et consommé en Task 2. `GLOBAL_NOTE_KEY` est produit en Task 1 et consommé en Tasks 3, 5 et 7. `SCRATCHPAD_REF_HREF_PREFIX` est produit en Task 2 et consommé en Task 3. `referencesNote` est produit en Task 1 et consommé en Task 5. `preprocessReferences` est produit en Task 2 et consommé en Task 3.

**Le build casse volontairement entre les tâches 1 et 3.** Task 1 supprime `wiki-links.ts`, dont `wiki.ts` dépend encore jusqu'à Task 3. Les tâches 1 à 3 doivent donc être exécutées et relues à la suite ; le premier `build` vert de la chaîne est celui de Task 3 step 6. Chaque tâche garde son test vert — c'est le typecheck global, pas les tests, qui attend Task 3.

**Ordre interne de Task 6.** `useMentionAutocomplete.test.ts` utilise `type: 'scratchpad'`, donc l'extension de `MentionTargetType` est le step 3 de Task 6, avant l'extraction — et non un step de Task 7, où elle aurait été trop tard.
