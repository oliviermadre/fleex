# Focus

Entrée de navbar `/focus`, placée avant Tasks : la liste des tickets **Doing / Reviewing** qui attendent une
intervention humaine, tous boards confondus. Le job de l'utilisateur est de garder cette liste vide.
Maquette d'origine : [`prototype.html`](./prototype.html).

## Ce qui entre dans la liste

Calculé côté serveur par `deriveFocusItems` (`packages/server/src/domain/services/focus-items.ts`), exposé
par `GET /api/focus`. Les règles reprennent celles des cartes HITL du fil de ticket (`gateCards`,
`waitingInputCards`, `ambiguousRoutingCards`, `failedStepCards`, `crashedMentionCards`) pour que Focus et le
ticket soient toujours d'accord.

| Type | Source | Action directe |
|---|---|---|
| Gate | étape `human_gate` en `needs_review` (dernière tentative, run actif) | une issue → `resolve` (commentaire joint possible) |
| Gate (route) | étape en `awaiting_routing` | une arête candidate → `route` |
| Question | mention agent en `waiting_for_info` | commentaire (réveille l'agent) |
| Question (étape) | étape non-gate en `needs_review` | commentaire + `retry` de l'étape avec la réponse |
| Erreur | étape `failed` du **dernier** run | `retry` de l'étape |
| Erreur | mention agent `failed` (session crashée) | `POST /mentions/:id/run` |
| Idle | rien en cours, en file ni en attente | reprendre la session CLI · relancer le dernier agent (`@agent:<nom>`) · faire avancer le statut (Doing → Reviewing, Reviewing → Done ; jamais Doing → Done) ; dans la popup, en plus : lancer un run (menu du SmartSessionButton) et commenter le ticket |

- Une ligne par ticket : gate > question > erreur > idle.
- Un ticket où un agent tourne ou attend son tour n'est ni idle ni en erreur (le nouveau run remplace l'échec),
  mais une gate ou une question reste affichée.
- Un ticket marqué `blocked` à la main n'apparaît pas en idle : il attend volontairement quelque chose.

### Sessions Claude Code en CLI

Le serveur ne voit pas les sessions Claude Code lancées dans un terminal. Le client corrige donc les items idle
avec le statut des hooks de ces sessions (`Session.hookStatus`, reçu en direct avec les `sessionGroups`), dans
`web/src/components/focus/focusSessions.ts` :

| Statut des sessions du ticket | Effet sur l'item idle |
|---|---|
| `working` | retiré (le ticket est « en cours ») |
| `waiting` · permission ou question | devient une **Question** (source `session`) → « Ouvrir la session », la réponse se donne dans le terminal |
| au repos (`complete`, `waiting` idle, `error`, `idle`) | reste idle, en attente depuis la fin du tour → « Ouvrir la session » en action principale |

- Plusieurs sessions du même worktree (les hooks arrivent sur toutes les sessions du cwd) : l'état le plus exigeant
  l'emporte (waiting > working > repos) ; à égalité, la session dont le pane fait tourner Claude (process `claude`
  ou numéro de version, ex. `2.1.284`), pour que « Ouvrir la session » ouvre le bon terminal.
- Une session `claude` dont le pane est revenu au shell n'a plus de Claude : son dernier statut est lu comme du repos.
- Limite connue : après une autorisation accordée, aucun hook ne part avant l'outil suivant ou la fin du tour,
  donc l'attente peut rester affichée un tour de trop.
- Seuls les items idle sont concernés : gates, questions d'agent et erreurs restent ceux du serveur.

### En cours (récap sous la liste)

`GET /api/focus` renvoie aussi `running` : les tickets Doing/Reviewing sur lesquels un agent travaille sans rien
attendre de l'humain. Source, dans l'ordre : étape de workflow en cours (`workflow`), session SDK active (`agent`),
mention en file (`queued`) ; le client y ajoute les sessions Claude CLI au travail (`cli`). Sous la liste, une ligne
« Pendant ce temps, N tickets avancent en autonomie » ; un clic déplie des lignes au format de la file (qui travaille,
depuis quand, coût), avec « Suivre les logs », « Ouvrir la session » (CLI), « Ouvrir dans Tasks » et le
SmartSessionButton. Replié par défaut ; l'état est mémorisé (préférence locale).

## Comportements côté client

- **Fenêtre d'annulation (5 s)** : une action masque la ligne tout de suite, mais l'appel API ne part qu'à la
  fin du délai, ce qui rend « Annuler » réel (une décision de gate n'est pas réversible côté serveur). Les
  actions en attente partent immédiatement si la page se ferme (`pagehide`).
- **Plus tard** : mise en pause par *raison* (`FocusItem.key`), donc elle expire d'elle-même si la raison change.
  Le nombre d'éléments en pause reste affiché.
- **Enchaîner** : après une action dans la popup, l'élément suivant s'ouvre.
- **Ouvrir dans Tasks** : sélectionne le ticket dans la work view (`/work`) ; repli sur le Kanban si la work
  view est désactivée.
- **Indicateurs** (masqués par le mode zen) : traités aujourd'hui, réaction médiane, plus ancien en attente,
  nombre de fois où la liste a été vidée. Ils sont calculés à partir d'un journal local au navigateur
  (`localStorage`, 30 jours), sans stockage serveur.
- **Live** : `useFocusFeed` (monté dans `AppLayout`) recharge la liste sur les événements WS `ticket:*`,
  `mention:*`, `workflow:*`, `execution:*` et `comment:created`, ce qui garde aussi le badge de la navbar à jour.

## Raccourcis

`J`/`K` naviguer · `⏎` détails · `1`–`3` action directe · `R` répondre · `L` lancer un agent
(SmartSessionButton) · `S` plus tard (1 h) · `O` ouvrir dans Tasks · `Échap` fermer.

## Hors périmètre de cette version

- Les routines en échec (sans ticket) : elles restent signalées par le badge Routines.
- Filtrer « à moi » sur un board partagé (assignee, auteur ou personne mentionnée) : à trancher.
- Le message d'erreur précis d'une étape en échec : il n'est pas persisté, la popup renvoie vers les logs.
