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
| Idle | rien en cours, en file ni en attente | relancer le dernier agent (`@agent:<nom>`) ou passer en Done |

- Une ligne par ticket : gate > question > erreur > idle.
- Un ticket où un agent tourne ou attend son tour n'est ni idle ni en erreur (le nouveau run remplace l'échec),
  mais une gate ou une question reste affichée.
- Un ticket marqué `blocked` à la main n'apparaît pas en idle : il attend volontairement quelque chose.

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
