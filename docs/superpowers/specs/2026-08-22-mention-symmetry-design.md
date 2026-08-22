# Symétrie des mentions sur toutes les surfaces markdown — Design

**Date** : 2026-08-22
**Branche** : `claude/fleex-feature-evolutions-7uszdu` (PR #274, ouverte)
**Suite de** : `2026-08-22-note-references-design.md`, qui a introduit `@scratchpad:` et l'autocomplétion des notes.

## Problème

Le chantier précédent a rendu la syntaxe de référence découvrable dans l'éditeur de notes. Il a laissé une asymétrie que sa propre décision explique à moitié seulement :

- Dans une note, `@agent:catalyst` reste du **texte brut**. La décision actée était « ne pas proposer de texte mort », mais la conséquence — on ne peut pas *citer* un agent dans une note — n'avait pas été pesée.
- Dans un commentaire, `@scratchpad:global` rend bien une puce, mais **aucune autocomplétion ne le suggère**. Personne n'a décidé ça : la spec précédente disait « les commentaires conservent leurs six primitives », sans envisager le cas inverse.

Résultat : huit formes de mention existent, deux surfaces en rendent des sous-ensembles différents, et deux sélecteurs proposent des sous-ensembles encore différents. Aucun de ces trois découpages ne coïncide.

## Objectif

Les huit formes se rendent et se proposent partout où c'est possible. Une note peut citer un agent, une skill, un panel, un workflow, une routine, un ticket, une note et un humain. Un commentaire peut citer une note. La description de ticket gagne un sélecteur qu'elle n'a jamais eu.

## Décisions actées

| Décision | Choix |
|---|---|
| Deux modes de rendu | **Assumés.** Dans un commentaire, les cinq primitives lançables restent des **mentions actionnables** (déclenchent, reliées à un enregistrement, croix d'annulation). Partout ailleurs, ce sont des **puces de référence** : clic → page de configuration de la primitive. |
| Apparence | **Distincte.** La puce de référence n'a pas de croix et porte un contour plutôt qu'un fond plein. Motif : la croix d'annulation n'a aucun sens hors commentaire, et une puce identique à celle qui déclenche un run laisserait croire qu'elle déclenche. |
| Préprocesseurs | **Fusionnés en un seul.** `preprocessReferences` et `preprocessMentions` ne diffèrent plus que par leur vocabulaire ; si le générique encode tout, ils sont la même fonction. La seconde regex géante disparaît. |
| Barré | Le renderer partagé gagne une branche `#fleex-struck:` rendant un barré grisé, ce qu'un barré signifie visuellement de toute façon. C'est ce qui permet la fusion. |
| Rendu des commentaires | **Inchangé.** `TicketComments` garde son override `a` et ses `MentionSpan`. Toucher à ça casserait le suivi des mentions et l'annulation des runs. |
| Sélecteur dans la description de ticket | **Oui.** Elle n'en a jamais eu, sur aucune primitive. |
| Mention humaine hors commentaire | Pastille sans navigation — il n'existe pas de page « personne ». |

## 1. Le vocabulaire, et ce que chaque forme devient

| Forme | Valeur | Commentaire de ticket | Toutes les autres surfaces |
|---|---|---|---|
| `@agent:<nom>` | `[a-zA-Z0-9_-]+` | mention actionnable | puce → config de l'agent |
| `@panel:<nom>` | idem | mention actionnable | puce → config du panel |
| `@skill:<commande>` | idem | mention actionnable | puce → éditeur de skill |
| `@workflow:<slug>` | idem | mention actionnable | puce → config du workflow |
| `@routine:<slug>` | idem | mention *référentielle déjà* (« never a trigger ») | puce → config de la routine |
| `@ticket:<id>` | displayId ou UUID | référence | référence (inchangé) |
| `@scratchpad:<clé>` | `global` ou `owner/name` | référence | référence (inchangé) |
| `@<prénom>` | `[a-zA-Z0-9_-]+` | mention humaine | pastille, sans navigation |

Une référence dans un code span ou une clôture reste ignorée, des deux côtés — acquis du chantier précédent.

## 2. Navigation — non uniforme, et il faut le savoir

Quatre primitives vivent dans le panneau `agents` et se sélectionnent de façon synchrone :

```ts
useUIStore.getState().setActivePanel('agents');
useAgentPersonaStore.getState().selectPersona(id);   // ou selectPanel / selectSkill / selectWorkflow
```

`MainPanel.tsx:128-136` dispatche ensuite sur `selectedPersonaId` / `selectedPanelId` / `selectedSkillId` / `selectedWorkflowId` pour rendre la bonne vue.

**La routine est l'exception** : son panneau est `routines` (`MainPanel.tsx:111`) et son `select()` est **asynchrone** — il charge l'historique. Donc :

```ts
useUIStore.getState().setActivePanel('routines');
void useRoutineStore.getState().select(id);
```

Le composant doit traiter ces deux cas, pas un seul. Une abstraction qui suppose « toujours `agents` » sera fausse pour une primitive sur cinq.

## 3. Résolution nom → entité

La syntaxe porte un **nom** (`@agent:catalyst`, `@skill:commit`) ; les stores sélectionnent par **id**. La puce résout donc le nom vers l'entité du store, exactement comme `TicketMentionChip` résout un `displayId`.

Champ de résolution par kind, à lire dans les stores :

| Kind | Store | Champ portant le nom mentionné |
|---|---|---|
| `agent` | `useAgentPersonaStore.personas` | `name` |
| `panel` | `usePanelStore.panels` | `name` |
| `skill` | `useSkillStore.skills` | `commandName` |
| `workflow` | `useWorkflowTemplateStore.workflowTemplates` | `slug` |
| `routine` | `useRoutineStore.routines` | `slug` |

`RoutinesPage` sélectionne par `id` (`routines.find((r) => r.id === selectedId)`) alors que la mention porte un `slug` : la résolution slug → id est donc obligatoire pour cette primitive, pas seulement souhaitable.

Un nom que le store ne connaît pas **dégrade en texte brut** — `@agent:disparu` s'affiche tel quel, pas en puce morte. C'est la règle que `TicketMentionChip` applique déjà, et elle compte : les primitives sont supprimables.

## 4. Un composant, cinq primitives

Nouveau `packages/web/src/components/markdown/PrimitiveRefChip.tsx`. Une seule implémentation paramétrée par le kind — cinq composants quasi identiques seraient exactement la duplication que `lib/primitives.tsx` existe pour empêcher.

Il rend le glyphe et le libellé de `PRIMITIVE_META`, la source de vérité visuelle déjà en place. Il navigue selon §2 et dégrade selon §3.

Le style « référence », concrètement : bordure `1px` dans la teinte du kind, fond transparent, et **pas de croix**. À comparer à la mention actionnable du commentaire, qui est un fond plein dans la même teinte **avec** croix. Le lecteur distingue les deux sans les lire côte à côte, et la teinte reste celle de la primitive — on ne change pas le langage de couleur, seulement le remplissage. Le libellé affiché est le nom lisible de l'entité résolue, jamais la syntaxe brute : `catalyst`, pas `@agent:catalyst` — c'est ce que `TicketMentionChip` fait déjà en affichant `#42 Titre du ticket`.

**Deux lacunes de données à combler d'abord.** `PRIMITIVE_META` ne couvre que les quatre primitives lançables — pas la routine. Et `MENTION_TYPE_META` n'a pas d'entrée `routine` non plus, alors que `MentionTargetType` doit désormais l'inclure pour que le sélecteur puisse la proposer. Il faut donc :

- ajouter `'routine'` à `MentionTargetType` ;
- lui donner une entrée `MENTION_TYPE_META` — lettre `R`, teinte libre (`indigo` ; `teal` est pris par `scratchpad` depuis le chantier précédent) ;
- **la routine retombe sur la pastille lettrée**, pas sur un nouveau glyphe. `MENTION_TYPE_TO_PRIMITIVE` est un `Partial`, donc `MentionTypeIcon` retombe déjà sur `MentionTypeBadge` pour tout kind qu'il ne connaît pas — c'est le chemin que `scratchpad` emprunte depuis le chantier précédent. Une routine n'est pas une primitive lançable ; lui dessiner un glyphe la ferait passer pour telle.

Effet de bord attendu : `PRIMITIVE_PREFIX` dans `useMentionAutocomplete.ts` contient déjà `routine`, signalé comme code mort par la revue du chantier précédent. Il devient vivant.

## 5. Les préprocesseurs fusionnent

`packages/web/src/components/markdown/mentions.ts` garde **une** fonction. `preprocessReferences` et `preprocessMentions` disparaissent au profit d'un seul `preprocessMentions` encodant les huit formes, barrées comprises.

Le fichier perd une regex de dix-sept alternatives et son callback de dix-huit paramètres positionnels — le morceau le plus délicat du chantier précédent, dont la revue avait dû compter les groupes à la main. C'est le gain de lisibilité principal de ce chantier.

L'ordre reste critique et pour la même raison : chaque alternative `@<primitive>:` doit précéder le repli humain `@[a-zA-Z0-9_-]+`, sans quoi `@scratchpad:acme/app` est capturé comme le mention humain `@scratchpad` avec un `:acme/app` orphelin.

## 6. Le renderer partagé

`packages/web/src/components/scratchpad/MarkdownRenderer.tsx` gagne, dans son override `a` :

- cinq branches `#fleex-agent:` / `#fleex-panel:` / `#fleex-skill:` / `#fleex-workflow:` / `#fleex-routine:` → `PrimitiveRefChip` ;
- une branche `#fleex-human:` → pastille sans navigation ;
- une branche `#fleex-struck:` → barré grisé.

Portée, inchangée depuis le chantier précédent : ce renderer alimente les notes, la description de ticket, les deliverables (trois surfaces), le transcript de l'assistant, le panneau de réponse mémoire et tout le mobile. Les puces s'allument partout d'un coup.

## 7. Les sélecteurs

| Surface | Aujourd'hui | Après |
|---|---|---|
| Éditeur de notes principal | `@ticket:` `@scratchpad:` | les **8** |
| Composer de commentaires | 6 primitives + `@ticket:` | + `@scratchpad:` |
| Description de ticket | **aucun** | les **8** |
| Deliverables, transcript, panneau mémoire, mobile | aucun | aucun — lecture seule ou pas d'éditeur |

Les cinq stores de primitives sont globaux, donc la construction de la liste est de la lecture directe, sans requête.

L'éditeur de notes et la description de ticket partagent la même liste des huit. Elle est construite **une fois**, dans un hook `useAllMentionOptions`, et non copiée dans deux composants — sans quoi les deux dériveront.

## 8. Ce qui ne change pas, et pourquoi

`TicketComments` garde son propre override `a` et ses `MentionSpan`. Ses puces de primitive portent un `mentionId` résolu depuis la map du commentaire et un `onRemove` qui annule un run. Les remplacer par des puces de référence supprimerait l'annulation des runs et le suivi des mentions.

C'est la seule surface à conserver un rendu spécifique. Il faut le dire dans le code, sinon le prochain lecteur « harmonisera » et cassera le déclenchement.

## 9. Tests

- **`mentions.ts`** : les huit formes encodées, actives et barrées ; l'ordre face au repli humain, pour chaque primitive ; code spans et clôtures préservés. Les 31 cas existants doivent passer sans édition — c'est le filet de la fusion.
- **`PrimitiveRefChip`** : pour chacun des cinq kinds, résolution du nom, navigation vers le bon panneau (`agents` pour quatre, `routines` pour une), dégradation en texte brut sur nom inconnu. La navigation de la routine est asynchrone : la tester comme telle.
- **`MarkdownRenderer`** : une note contenant les huit formes rend huit éléments du bon type ; `#fleex-struck:` rend un barré ; `#fleex-human:` ne navigue pas.
- **`TicketComments`** : non-régression. Les cinq primitives restent actionnables, la croix d'annulation fonctionne, et `@scratchpad:` apparaît désormais dans le sélecteur.
- **Description de ticket** : le sélecteur s'ouvre sur `@` et insère.
- **`useAllMentionOptions`** : les huit kinds présents, tickets marqués `deferred`, et le plafond appliqué.

## Hors périmètre

- **Les deux copies inline restantes** de l'autocomplétion `lastIndexOf('@')`, dans `assistant/AssistantComposer.tsx` et `mobile/MobileConversation.tsx`. Maintenant que le hook existe, c'est une consolidation propre — mais séparée.
- **`ScratchpadPanel` (overlay ⌥⇧P) et `ScratchpadContent` (sidebar droite)**, toujours sans sélecteur. Signalés par la revue du chantier précédent, toujours non tranchés.
- **`relatedNotes()` à `limit: 6`**, qui rend la moitié « Related » du panneau structurellement vide pour toute note de six chunks ou plus. Préexistant, indépendant de la syntaxe.
- **L'alias `[[cible|libellé]]`**, perdu au chantier précédent et assumé.
