# Références de notes — `@scratchpad:` et autocomplétion — Design

**Date** : 2026-08-22
**Branche** : `claude/fleex-feature-evolutions-7uszdu` (PR #274, ouverte)
**Origine** : recette du moteur mémoire — le point `wikiLinks` a échoué au premier test.

## Problème

La syntaxe `[[…]]` fonctionne exactement comme elle est écrite, mais personne ne peut la découvrir. Son vocabulaire est fermé à trois formes — `[[#42]]`, `[[global]]`, `[[org/repo]]` — et rien dans l'interface ne l'enseigne : pas d'autocomplétion, et `NoteLinksPanel` retourne `null` quand ses deux listes sont vides. Le premier test de recette a donc porté sur `[[backlink-should-be-clickable]]`, que `classify()` range en `unresolved` et que `preprocessWikiLinks` laisse verbatim — par conception, pour ne pas produire de puce menant nulle part.

Trois défauts en découlent :

1. **L'artifact de recette décrit une fonctionnalité inexistante.** Il demande d'écrire `[[une-autre-note]]`, précisément un cas qui ne peut jamais résoudre.
2. **Aucune affordance.** Rien n'indique que la fonctionnalité existe, ni quel vocabulaire elle accepte.
3. **`[[#9999]]` sur un ticket inconnu affiche `@ticket:9999`.** `TicketMentionChip` renvoie le texte de repli de *sa* syntaxe, pas celle qui a été tapée.

## État mesuré

Corpus indexé de l'instance de développement, `fleex memory status` au 2026-08-20 :

| Source | Chunks | Part |
|---|---:|---:|
| deliverable | 12 884 | 76 % |
| ticket | 1 879 | 11 % |
| comment thread | 1 635 | 10 % |
| ticket summary | 375 | 2 % |
| skill · persona · epic | 168 | 1 % |
| **scratchpad** | **7** | **0,04 %** |

`memory search -k scratchpad` ne remonte qu'une note : `__global__`. Aucune note de repo n'existe. Les deliverables, qui pèsent 76 % du corpus, n'ont aucune syntaxe de référence textuelle — ils ne sont reliés qu'implicitement par `execution.deliverableId`.

Ce chiffre commande deux arbitrages : pas d'ancres de section (on ne construit pas un adressage fin pour 7 chunks), et pas d'élargissement aux deliverables dans ce chantier.

## Décisions actées

| Décision | Choix |
|---|---|
| Grammaire | **Une seule** : `@scratchpad:global` et `@scratchpad:<org>/<name>`. La syntaxe `[[…]]` disparaît entièrement. Motif : `@ticket:123` produit déjà une puce dans une note, donc `[[@ticket:123]]` aurait été une troisième orthographe pour la même destination. |
| Ancres de section | **Non.** Une note fait 7 chunks ; la référencer entièrement ne perd aucune précision réelle. Écarté, pas abandonné. |
| Primitives dans l'éditeur de notes | **`@ticket:` et `@scratchpad:` seulement** — les deux qui naviguent et rendent une puce. `@agent:` / `@panel:` / `@skill:` / `@workflow:` ne déclenchent rien depuis une note et n'y rendent aucune puce ; les proposer insérerait du texte mort. Les commentaires conservent leurs six primitives. |
| Gating | **La navigation est indépendante du mode mémoire**, comme `@ticket:` l'est déjà. Puce et backlinks exacts : toujours actifs, y compris en moteur `legacy`. Seul « Related », qui interroge l'index vectoriel, reste derrière un drapeau. |
| Drapeau | **`wikiLinks` → `relatedNotes`.** `MemoryFeatureFlags` se déclare « Features that consume the retrieval index » et `isMemoryFeatureEnabled` refuse tout hors moteur sémantique : la puce et le scan de texte quittent cette famille. PR #274 étant ouverte, le renommage ne coûte ni shim ni migration de config. |
| Migration de contenu | Vérification du KV store avant suppression du parseur. Attendu : zéro occurrence. |

## 1. Grammaire — `packages/shared`

`src/wiki-links.ts` devient `src/note-refs.ts`.

**Syntaxe** — `@scratchpad:global` ou `@scratchpad:<org>/<name>`, avec `<org>` et `<name>` sur `[\w.-]+`. Normalisation vers la clé KV, à l'identique de l'actuel `classify()` : `global` → `__global__`, `Org/Repo` → `org/repo` en minuscules.

**API exportée**

- `parseNoteRefs(text): NoteRef[]` — `{ raw, key, start, end }`. Remplace `parseWikiLinks`.
- `collectNoteRefs(text): string[]` — clés distinctes, pour l'indexation des backlinks. Remplace `collectWikiLinkTargets`, **sans** sa branche ticket : le seul consommateur est le scan de backlinks du serveur, qui ne demande jamais que des clés de scratchpad.
- `referencesNote(text, key): boolean`. Remplace `linksTo`.

**Supprimés** — `parseWikiLinks`, `WikiLink`, `WikiLinkKind`, `WIKI_LINK_RE`, `TICKET_REF_RE`, `REPO_REF_RE`, et les ré-exports correspondants de `src/index.ts`.

## 2. Rendu — `packages/web`

### 2.1 `components/markdown/mentions.ts`

Une alternative `@scratchpad:(global|[\w.-]+\/[\w.-]+)` ajoutée aux **deux** préprocesseurs, en variante active et barrée (`~~…~~`), cohérente avec les six primitives existantes.

Elle doit être placée **avant** le repli humain `@[a-zA-Z0-9_-]+`. Sans cet ordre, `@scratchpad:acme/app` est capturé comme le mention humain `@scratchpad` en laissant un `:acme/app` orphelin — exactement le piège que le commentaire sur l'ordre de `@ticket:` documente déjà.

Href produit : `#fleex-scratchpad:<clé encodée>`. La clé est URI-encodée, parce qu'elle contient une barre oblique qui terminerait la destination Markdown prématurément.

`preprocessTicketMentions` est renommé `preprocessReferences` : il couvre désormais deux primitives, et son nom actuel deviendrait faux.

### 2.2 Puce

Nouveau `components/markdown/NoteRefChip.tsx` : le `NoteLinkChip` interne de `WikiLinkChip.tsx`, extrait tel quel. Navigation par `setActivePanel('scratchpads')` puis `setSelectedScratchpadKey(key)`. Libellé : `Global` pour `__global__`, la clé sinon.

Une clé qui ne correspond à aucune note existante rend quand même une puce. L'autocomplétion ne propose que des notes réelles ; une clé saisie à la main peut précéder la note, et refuser le lien rendrait la référence inutile dans le cas où elle sert le plus.

### 2.3 `components/scratchpad/MarkdownRenderer.tsx`

La branche `WIKI_LINK_HREF_PREFIX` de l'override `a` devient `#fleex-scratchpad:` et rend `NoteRefChip`. Le sélecteur `wikiEnabled` (ligne 189) et la préprocession conditionnelle disparaissent : `preprocessReferences` tourne inconditionnellement, comme aujourd'hui pour les tickets.

Portée : ce renderer alimente les notes, la description de ticket, les deliverables (trois surfaces), le transcript de l'assistant, le panneau de réponse mémoire et tout le mobile. La puce s'allume partout.

### 2.4 Supprimés

`components/markdown/wiki.ts`, `wiki.test.ts`, `WikiLinkChip.tsx`, `components/scratchpad/MarkdownRenderer.wiki-link.test.tsx`.

## 3. Autocomplétion

`MarkdownEditor.tsx:54` documente déjà son `textareaRef` comme « pass a ref when the caller needs the textarea (caret handling, autocomplete anchoring) ». L'extraction prend la forme que le fichier anticipait.

### 3.1 Extraction depuis `TicketComments.tsx`

Sortis vers `components/markdown/` :

- **`useMentionAutocomplete.ts`** — l'état `acOpen` / `acQuery` / `acIndex` (563-565), la détection du déclencheur `@`, `acceptMention` (1252), la branche clavier ↑↓/Entrée/Échap/Tab (1297-1337), et le calcul de position d'ancrage. La liste d'options devient un **paramètre** : le hook ne connaît aucune primitive.
- **`MentionMenu.tsx`** — `MentionAutocomplete` (483) et l'interface `MentionOption` (474), déplacés tels quels. `MentionOption.type` gagne `'scratchpad'`.

`TicketComments` continue de construire ses six primitives — `agent`, `panel`, `skill`, `workflow`, `human`, `ticket` — et les passe au hook. Son plafond `MAX_TICKET_SUGGESTIONS` et sa règle « `@` nu ne déverse pas tous les tickets » remontent dans le hook, où ils s'appliquent à toute liste volumineuse.

À noter : `@routine:` est rendu par `mentions.ts` mais n'a jamais été proposé par l'autocomplétion — son commentaire le décrit comme « reference only — never a trigger ». Ce chantier ne change pas cet état.

Ordre de grandeur : environ 150 lignes quittent un fichier de 1848.

### 3.2 Câblage dans l'éditeur de notes

`ScratchpadMainView` construit sa liste — les tickets chargés plus les notes connues — et branche le hook sur le `textareaRef` de `MarkdownEditor`.

Les notes proposées viennent de `GET /api/scratchpads`, qui retourne déjà exactement ce qu'il faut : `{ items: [{ key, label, lineCount }] }`, avec `__global__` étiqueté `Global`, les notes écrites, et — via le paramètre `repos` — **les repos configurés qui n'ont encore aucune note**, à `lineCount: 0`. Aucun travail serveur n'est nécessaire, et référencer une note de repo jamais écrite est légitime (§2.2).

## 4. Backlinks — `packages/server`

`infrastructure/http/scratchpad.routes.ts` :

- Le scan (ligne 88) échange `linksTo` contre `referencesNote`.
- Le garde `isMemoryFeatureEnabled(config, 'wikiLinks')` en tête de la route (ligne 76) **disparaît** pour les backlinks : ils sont un scan de texte sur une poignée de notes, sans index. La route retourne toujours ses backlinks exacts.
- `relatedNotes()` reste gardé, désormais par `isMemoryFeatureEnabled(config, 'relatedNotes')` — il appelle `retrieveContext.search`, donc l'index. Drapeau coupé ou moteur `legacy` : `related` retourne `[]`, `backlinks` reste peuplé.

`NoteLinksPanel` perd son sélecteur `enabled` et s'affiche dès qu'une des deux listes est non vide. L'état vide reste silencieux : c'est l'autocomplétion qui enseigne la syntaxe, pas un encart permanent.

## 5. Renommage du drapeau

`wikiLinks` → `relatedNotes` dans :

- `packages/server/src/application/ports/config.port.ts` — champ de `MemoryFeatureFlags` et entrée de `MEMORY_FEATURE_KEYS`. Nouvelle description : « Surface semantically related notes under a note. »
- `packages/web/src/stores/settingsStore.ts` — type `memoryFeatures`.
- `packages/web/src/components/settings/MemoryTab.tsx` — libellé et description du basculeur.
- `packages/cli/src/commands/memory/_shared.ts` — `MEMORY_FEATURE_KEYS`, qui **duplique** la liste du serveur au lieu de l'importer. Le renommage doit toucher les deux, sinon `fleex memory engine --enable` accepte une clé que le serveur ignore. Unifier les deux listes est hors périmètre, mais la divergence est réelle et mérite d'être notée.
- `packages/server/tests/unit/memory-feature-flags.test.ts`.

Aucune normalisation de config : PR #274 n'est pas fusionnée, le drapeau n'a jamais atteint `main`, et la seule instance qui le porte l'a à sa valeur par défaut. Un utilisateur qui perdrait une clé `wikiLinks: false` persistée retrouverait `relatedNotes` activé — cas inatteignable ici, et à revérifier si la PR fusionne avant ce chantier.

## 6. Migration de contenu

Avant suppression du parseur, recherche des `[[…]]` résolvables survivants dans les valeurs `scratchpad:*` du KV store. Attendu : zéro — une seule note existe, et la chaîne de test de la recette était non résolvable.

Une occurrence trouvée dans une note est réécrite vers `@scratchpad:` / `@ticket:`. Les occurrences dans les deliverables et commentaires ne demandent rien : elles rendent déjà du texte brut aujourd'hui pour les cibles non résolvables, et les cibles résolvables y sont improbables.

Effet de bord : le défaut n°3 disparaît sans correction dédiée. Sans crochets, `@ticket:9999` sur un ticket inconnu affiche `@ticket:9999`, ce qui est exactement ce qui a été tapé.

## 7. Documentation

- `README.md` — la section décrivant les backlinks `[[…]]`.
- L'artifact de recette (`789d95c3-ae74-47a2-a827-5c6a6d9abb59`), carte `wikiLinks` : nouvelle syntaxe, nouveau nom de drapeau, et une étape de validation réellement exécutable — écrire `@scratchpad:` dans une note, choisir une entrée dans l'autocomplétion, cliquer la puce.

## 8. Tests

En TDD : test rouge avant chaque implémentation.

**`packages/shared`** — `@scratchpad:Org/Repo` normalise en minuscules ; `@scratchpad:global` donne `__global__` ; une occurrence dans un code span ou une clôture est ignorée ; `@scratchpadfoo` n'est pas capturé ; `collectNoteRefs` dédoublonne ; `referencesNote` distingue deux clés voisines.

**`packages/web`** — `mentions.ts` : `@scratchpad:acme/app` produit un href complet et n'est pas mangé par le repli humain ; la variante barrée rend `#fleex-struck:`. `MarkdownRenderer` : la puce rend, navigue, et **rend en moteur `legacy`** — c'est le test qui verrouille le dégatage. `useMentionAutocomplete` : déclenchement sur `@`, filtrage, insertion au curseur, navigation clavier, `@` nu ne déverse pas la liste longue.

**`packages/server`** — le scan trouve une référence `@scratchpad:__global__` ; une note ne se cite pas elle-même ; `related` est vide sous `relatedNotes: false` alors que `backlinks` reste peuplé ; les backlinks sortent en moteur `legacy`.

Les tests supprimés (`wiki.test.ts`, `MarkdownRenderer.wiki-link.test.tsx`, `wiki-links.test.ts` côté serveur) sont remplacés, pas abandonnés : chaque comportement qu'ils couvraient a son équivalent ci-dessus.

## Hors périmètre

Écartés de ce chantier, sans être abandonnés :

- **Ancres de section** (`@scratchpad:global#ma-section`). Le chunker découpe déjà sur `##`/`###` en appelant une section « l'unité qu'un lecteur citerait », donc la fondation existe. À rouvrir quand une note dépassera un écran.
- **`@deliverable:` et `@epic:`.** C'est là que vit le vrai problème de précision — 76 % du corpus, des documents de plusieurs écrans, aucune syntaxe de référence.
- **Puces `@agent:` / `@skill:` dans les notes.** Demanderait de remonter six composants de puce depuis `TicketComments` vers le renderer partagé.
- **L'alias `[[cible|libellé]]`.** L'ancienne syntaxe permettait de renommer un lien en prose ; la nouvelle non, parce qu'aucun `@primitive:value` de Fleex ne prend d'alias et qu'en ajouter un à `@scratchpad:` seul casserait la cohérence qui est la raison d'être de ce chantier. La perte est réelle et assumée : la puce fournit déjà un libellé lisible (`Global`, ou la clé du repo), et un alias qui compte se dit dans la phrase autour. À rouvrir si l'usage montre que le libellé automatique ne suffit pas.
